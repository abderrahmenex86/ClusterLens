from __future__ import annotations

import json
import math
import os
import pickle
import re
import shutil
import time
import uuid
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

import numpy as np
from PIL import Image

from .config import Settings
from .db import Database, now_iso
from .jobs import JobContext, enqueue_job
from .ml import (
    SUPPORTED_EXTENSIONS,
    FaceResult,
    ImageAsset,
    ImageEmbedder,
    load_image_asset,
    save_face_crop,
    save_thumbnails,
    sha256_file,
)


IGNORE_DIRS = {
    ".git",
    ".svn",
    "node_modules",
    "__pycache__",
    ".thumbnails",
    "@eaDir",
    "#recycle",
    "__MACOSX",
    ".cache",
    "venv",
    ".venv",
}

FACE_EMBEDDING_MODEL = "insightface_buffalo_l"

DOCUMENT_LABELS = (
    "document",
    "screenshot",
    "receipt",
    "whiteboard",
    "paper",
    "book",
    "form",
)


class ServiceError(Exception):
    pass


class ModelNotReady(ServiceError):
    pass


def row_to_dict(row: Any) -> dict[str, Any] | None:
    return None if row is None else {key: row[key] for key in row.keys()}


def _safe_name(value: str, fallback: str = "Unknown", max_length: int = 100) -> str:
    value = (value or "").strip()
    value = re.sub(r"[\\/:*?\"<>|\x00-\x1f]", "", value)
    value = re.sub(r"\s+", " ", value).strip(" .")
    if not value:
        value = fallback
    if len(value) > max_length:
        value = value[:max_length].rstrip()
    return value


def _source_paths(db: Database) -> list[Path]:
    return [Path(row["path"]) for row in db.query("SELECT path FROM sources")]


def _canonical_file(db: Database, image_id: int):
    return db.query_one(
        "SELECT * FROM files WHERE image_id = ? AND missing_at IS NULL "
        "ORDER BY size DESC, id ASC LIMIT 1",
        (image_id,),
    )


def _image_people(db: Database, image_id: int) -> list[dict[str, Any]]:
    rows = db.query(
        "SELECT DISTINCT p.id, p.name FROM faces f "
        "JOIN people p ON p.id = f.person_id "
        "WHERE f.image_id = ? AND f.person_id IS NOT NULL AND f.ignored_at IS NULL "
        "ORDER BY p.name",
        (image_id,),
    )
    return [{"id": int(row["id"]), "name": str(row["name"])} for row in rows]


def _primary_scene(db: Database, image_id: int) -> str | None:
    row = db.query_one(
        "SELECT label FROM scene_labels WHERE image_id = ? AND is_primary = 1 "
        "ORDER BY score DESC LIMIT 1",
        (image_id,),
    )
    if row:
        return str(row["label"])
    row = db.query_one(
        "SELECT label FROM scene_labels WHERE image_id = ? ORDER BY score DESC LIMIT 1",
        (image_id,),
    )
    return str(row["label"]) if row else None


def _document_label(db: Database, image_id: int) -> str | None:
    placeholders = ",".join("?" for _ in DOCUMENT_LABELS)
    row = db.query_one(
        f"SELECT label FROM scene_labels WHERE image_id = ? AND is_primary = 1 "
        f"AND label IN ({placeholders}) "
        "ORDER BY score DESC LIMIT 1",
        (image_id, *DOCUMENT_LABELS),
    )
    return str(row["label"]) if row else None


def _face_count(db: Database, image_id: int) -> int:
    return int(
        db.scalar(
            "SELECT COUNT(*) FROM faces WHERE image_id = ? AND ignored_at IS NULL",
            (image_id,),
        )
        or 0
    )


class Services:
    def __init__(self, settings: Settings, db: Database):
        self.settings = settings
        self.db = db
        from .ml import MLRegistry

        self.ml = MLRegistry(settings)
        self.handlers = {
            "scan": self.handle_scan,
            "thumbnail": self.handle_thumbnail,
            "analyze": self.handle_analyze,
            "assign": self.handle_assign,
            "cluster": self.handle_cluster,
            "train_classifier": self.handle_train_classifier,
            "reembed_face": self.handle_reembed_face,
            "export": self.handle_export,
        }

    # ------------------------------------------------------------------ scan
    def handle_scan(self, ctx: JobContext) -> None:
        source_id = int(ctx.payload.get("source_id") or ctx.job.get("source_id") or 0)
        source = self.db.query_one("SELECT * FROM sources WHERE id = ?", (source_id,))
        if source is None:
            raise ServiceError(f"Source {source_id} not found")
        if not int(source["enabled"]):
            return

        root = Path(source["path"])
        if not root.exists() or not root.is_dir():
            self.db.execute(
                "UPDATE sources SET status = 'offline', last_error = ?, last_scan_at = ? WHERE id = ?",
                ("Folder is not available", now_iso(), source_id),
            )
            raise ServiceError(f"Source folder is not available: {root}")

        self.db.execute(
            "UPDATE sources SET status = 'scanning', last_error = NULL WHERE id = ?",
            (source_id,),
        )
        scan_id = ctx.job_id
        recursive = bool(int(source["recursive"]))
        seen = 0
        new_images = 0
        errors = 0

        try:
            for current_root, dirs, files in os.walk(root, followlinks=False):
                dirs[:] = [
                    name
                    for name in dirs
                    if name not in IGNORE_DIRS and not name.startswith(".")
                ]
                if not recursive:
                    dirs[:] = []
                for name in files:
                    ctx.checkpoint()
                    path = Path(current_root) / name
                    if path.is_symlink() or name.startswith("."):
                        continue
                    if path.suffix.lower() not in SUPPORTED_EXTENSIONS:
                        continue
                    try:
                        stat = path.stat()
                    except OSError as exc:
                        errors += 1
                        ctx.log_error(f"Cannot stat {path}: {exc}", "file", None)
                        continue

                    rel_path = str(path.relative_to(root))
                    existing = self.db.query_one(
                        "SELECT * FROM files WHERE source_id = ? AND rel_path = ?",
                        (source_id, rel_path),
                    )
                    seen += 1
                    if (
                        existing is not None
                        and int(existing["size"]) == stat.st_size
                        and int(existing["mtime_ns"]) == stat.st_mtime_ns
                        and existing["image_id"] is not None
                    ):
                        self.db.execute(
                            "UPDATE files SET last_seen_scan_id = ?, missing_at = NULL, "
                            "status = 'ok' WHERE id = ?",
                            (scan_id, existing["id"]),
                        )
                        if seen % 25 == 0:
                            ctx.progress(seen, 0, f"Scanning {source['label']}")
                        continue

                    try:
                        content_hash = sha256_file(path)
                    except OSError as exc:
                        errors += 1
                        ctx.log_error(f"Cannot read {path}: {exc}", "file", None)
                        continue

                    image = self.db.query_one(
                        "SELECT id FROM images WHERE content_hash = ?",
                        (content_hash,),
                    )
                    if image is None:
                        cur = self.db.execute(
                            "INSERT INTO images (content_hash, status, created_at) "
                            "VALUES (?, 'pending', ?)",
                            (content_hash, now_iso()),
                        )
                        image_id = int(cur.lastrowid)
                        new_images += 1
                    else:
                        image_id = int(image["id"])

                    self.db.execute(
                        "INSERT INTO files (source_id, rel_path, size, mtime_ns, "
                        "content_hash, image_id, status, last_seen_scan_id) "
                        "VALUES (?, ?, ?, ?, ?, ?, 'ok', ?) "
                        "ON CONFLICT(source_id, rel_path) DO UPDATE SET "
                        "size = excluded.size, mtime_ns = excluded.mtime_ns, "
                        "content_hash = excluded.content_hash, image_id = excluded.image_id, "
                        "status = 'ok', missing_at = NULL, "
                        "last_seen_scan_id = excluded.last_seen_scan_id",
                        (
                            source_id,
                            rel_path,
                            stat.st_size,
                            stat.st_mtime_ns,
                            content_hash,
                            image_id,
                            scan_id,
                        ),
                    )
                    if seen % 10 == 0:
                        ctx.progress(seen, 0, f"Scanning {source['label']} · {seen} files")

            self.db.execute(
                "UPDATE files SET missing_at = ?, status = 'missing' "
                "WHERE source_id = ? AND missing_at IS NULL "
                "AND (last_seen_scan_id IS NULL OR last_seen_scan_id != ?)",
                (now_iso(), source_id, scan_id),
            )
            self.db.execute(
                "UPDATE sources SET status = 'idle', last_scan_at = ?, last_error = ? WHERE id = ?",
                (now_iso(), f"{errors} file errors" if errors else None, source_id),
            )
            ctx.progress(seen, seen, f"Scanned {seen} files · {new_images} new images")

            pending_thumbs = int(
                self.db.scalar(
                    "SELECT COUNT(*) FROM images i WHERE i.thumb_at IS NULL "
                    "AND i.status != 'error' "
                    "AND EXISTS (SELECT 1 FROM files f WHERE f.image_id = i.id "
                    "AND f.missing_at IS NULL)"
                )
                or 0
            )
            if pending_thumbs:
                enqueue_job(self.db, "thumbnail", "io", priority=30)
            if new_images:
                enqueue_job(self.db, "analyze", "ml", priority=20)
        except Exception:
            self.db.execute(
                "UPDATE sources SET status = 'error', last_error = ? WHERE id = ?",
                ("Scan failed; see job errors", source_id),
            )
            raise

    # -------------------------------------------------------------- thumbnail
    def handle_thumbnail(self, ctx: JobContext) -> None:
        rows = self.db.query(
            "SELECT i.* FROM images i WHERE i.thumb_at IS NULL AND i.status != 'error' "
            "AND EXISTS (SELECT 1 FROM files f WHERE f.image_id = i.id AND f.missing_at IS NULL) "
            "ORDER BY i.id"
        )
        total = len(rows)
        if total == 0:
            return
        ctx.set_total(total, "images")
        ctx.progress(0, total, f"Generating thumbnails · 0/{total}")

        for index, image in enumerate(rows, start=1):
            ctx.checkpoint()
            image_id = int(image["id"])
            file_row = _canonical_file(self.db, image_id)
            if file_row is None:
                continue
            source = self.db.query_one(
                "SELECT path FROM sources WHERE id = ?", (file_row["source_id"],)
            )
            if source is None:
                continue
            abs_path = Path(source["path"]) / file_row["rel_path"]
            try:
                asset = load_image_asset(abs_path)
                save_thumbnails(asset.image, image_id, self.settings.thumbs_dir)
                self.db.execute(
                    "UPDATE images SET width = ?, height = ?, orientation = ?, "
                    "mime_type = ?, date_taken = COALESCE(date_taken, ?), "
                    "date_source = CASE WHEN date_taken IS NULL THEN ? ELSE date_source END, "
                    "phash = ?, thumb_at = ?, "
                    "status = CASE WHEN status = 'pending' THEN 'thumbed' ELSE status END, "
                    "error = NULL WHERE id = ?",
                    (
                        asset.width,
                        asset.height,
                        asset.orientation,
                        asset.mime_type,
                        asset.date_taken,
                        asset.date_source,
                        asset.phash,
                        now_iso(),
                        image_id,
                    ),
                )
            except Exception as exc:
                self.db.execute(
                    "UPDATE images SET status = 'error', error = ? WHERE id = ?",
                    (f"thumbnail: {exc}"[:1500], image_id),
                )
                ctx.log_error(str(exc), "image", image_id)
            ctx.progress(index, total, f"Generating thumbnails · {index}/{total}")

        pending = int(
            self.db.scalar(
                "SELECT COUNT(*) FROM images i WHERE i.thumb_at IS NULL AND i.status != 'error' "
                "AND EXISTS (SELECT 1 FROM files f WHERE f.image_id = i.id AND f.missing_at IS NULL)"
            )
            or 0
        )
        if pending:
            enqueue_job(
                self.db, "thumbnail", "io", priority=30, reuse_active=False
            )

    # --------------------------------------------------------------- analyze
    def handle_analyze(self, ctx: JobContext) -> None:
        missing_thumbs = int(
            self.db.scalar(
                "SELECT COUNT(*) FROM images i WHERE i.thumb_at IS NULL AND i.status != 'error' "
                "AND EXISTS (SELECT 1 FROM files f WHERE f.image_id = i.id AND f.missing_at IS NULL)"
            )
            or 0
        )
        if missing_thumbs:
            enqueue_job(self.db, "thumbnail", "io", priority=30)

        rows = self.db.query(
            "SELECT i.* FROM images i WHERE "
            "(i.faces_at IS NULL OR i.embed_at IS NULL OR i.scene_at IS NULL) "
            "AND i.status != 'error' "
            "AND EXISTS (SELECT 1 FROM files f WHERE f.image_id = i.id AND f.missing_at IS NULL) "
            "ORDER BY i.id"
        )
        total = len(rows)
        if total == 0:
            return
        ctx.set_total(total, "images")
        ctx.progress(0, total, f"Analyzing {total} images")

        min_det_score = float(self.db.get_setting("face_min_det_score", "0.6") or 0.6)
        min_face_size = int(self.db.get_setting("face_min_size", "48") or 48)
        scenes_enabled = (self.db.get_setting("scenes_enabled", "1") or "1") == "1"
        embedder = self.ml.images

        for index, image in enumerate(rows, start=1):
            ctx.checkpoint()
            image_id = int(image["id"])
            file_row = _canonical_file(self.db, image_id)
            if file_row is None:
                continue
            source = self.db.query_one(
                "SELECT path FROM sources WHERE id = ?", (file_row["source_id"],)
            )
            if source is None:
                continue
            abs_path = Path(source["path"]) / file_row["rel_path"]

            try:
                asset = load_image_asset(abs_path)
            except Exception as exc:
                self._mark_image_error(image_id, f"Cannot decode: {exc}")
                ctx.log_error(str(exc), "image", image_id)
                ctx.progress(index, total, f"Analyzing · {index}/{total}")
                continue

            error_parts: list[str] = []
            need_faces = image["faces_at"] is None
            need_embed = image["embed_at"] is None
            need_scene = scenes_enabled and image["scene_at"] is None
            vector: np.ndarray | None = None

            if not need_embed:
                embedding_row = self.db.query_one(
                    "SELECT vector FROM image_embeddings WHERE image_id = ? AND model = ?",
                    (image_id, self.settings.image_model),
                )
                if embedding_row is not None:
                    vector = np.frombuffer(embedding_row["vector"], dtype=np.float32)
                else:
                    need_embed = True
            if need_scene and vector is None:
                need_embed = True

            if need_faces:
                faces: list[FaceResult] = []
                try:
                    faces = self.ml.faces.analyze(asset.image, min_face_size)
                    faces = [f for f in faces if f.det_score >= min_det_score]
                    self.db.execute(
                        "DELETE FROM faces WHERE image_id = ? AND bbox_source = 'model'",
                        (image_id,),
                    )
                    now = now_iso()
                    for face in faces:
                        cur = self.db.execute(
                            "INSERT INTO faces (image_id, bbox_x1, bbox_y1, bbox_x2, bbox_y2, "
                            "det_score, quality, embedding, embedding_model, bbox_source, "
                            "created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'model', ?, ?)",
                            (
                                image_id,
                                *face.bbox,
                                face.det_score,
                                face.quality,
                                face.embedding.astype(np.float32).tobytes(),
                                FACE_EMBEDDING_MODEL,
                                now,
                                now,
                            ),
                        )
                        face_id = int(cur.lastrowid)
                        try:
                            save_face_crop(
                                asset.image, face.bbox, face_id, self.settings.faces_dir
                            )
                        except Exception:
                            pass
                    self.db.execute(
                        "UPDATE images SET faces_at = ? WHERE id = ?",
                        (now, image_id),
                    )
                except Exception as exc:
                    error_parts.append(f"faces: {exc}")

            if need_embed and self.settings.embeddings_enabled:
                try:
                    vectors = embedder.embed_images([asset.image])
                    vector = vectors[0]
                    self.db.execute(
                        "INSERT OR REPLACE INTO image_embeddings "
                        "(image_id, model, vector, created_at) VALUES (?, ?, ?, ?)",
                        (
                            image_id,
                            self.settings.image_model,
                            vector.astype(np.float32).tobytes(),
                            now_iso(),
                        ),
                    )
                    self.db.execute(
                        "UPDATE images SET embed_at = ? WHERE id = ?",
                        (now_iso(), image_id),
                    )
                except Exception as exc:
                    error_parts.append(f"embedding: {exc}")
                    self.db.execute(
                        "UPDATE images SET embed_at = ? WHERE id = ?",
                        (now_iso(), image_id),
                    )
            elif need_embed:
                self.db.execute(
                    "UPDATE images SET embed_at = ? WHERE id = ?", (now_iso(), image_id)
                )

            if need_scene and vector is not None:
                try:
                    labels = embedder.label_image(vector, top_k=5)
                    self.db.execute(
                        "DELETE FROM scene_labels WHERE image_id = ? AND model = ?",
                        (image_id, self.settings.image_model),
                    )
                    now = now_iso()
                    for rank, (label, score) in enumerate(labels):
                        self.db.execute(
                            "INSERT INTO scene_labels (image_id, model, label, score, "
                            "is_primary, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                            (
                                image_id,
                                self.settings.image_model,
                                label,
                                score,
                                1 if rank == 0 and score >= 0.03 else 0,
                                now,
                            ),
                        )
                    self.db.execute(
                        "UPDATE images SET scene_at = ? WHERE id = ?",
                        (now, image_id),
                    )
                except Exception as exc:
                    error_parts.append(f"scenes: {exc}")
                    self.db.execute(
                        "UPDATE images SET scene_at = ? WHERE id = ?",
                        (now_iso(), image_id),
                    )
            elif need_scene:
                self.db.execute(
                    "UPDATE images SET scene_at = ? WHERE id = ?", (now_iso(), image_id)
                )
            if not scenes_enabled and image["scene_at"] is None:
                self.db.execute(
                    "UPDATE images SET scene_at = ? WHERE id = ?", (now_iso(), image_id)
                )

            self.db.execute(
                "UPDATE images SET status = ?, error = ? WHERE id = ?",
                (
                    "done" if not error_parts else "partial",
                    "; ".join(error_parts)[:1500] if error_parts else None,
                    image_id,
                ),
            )
            if error_parts:
                ctx.log_error("; ".join(error_parts), "image", image_id)
            ctx.progress(index, total, f"Analyzing · {index}/{total} images")

        enqueue_job(self.db, "assign", "ml", priority=15)
        unsorted_count = int(
            self.db.scalar(
                "SELECT COUNT(*) FROM faces WHERE person_id IS NULL AND ignored_at IS NULL"
            )
            or 0
        )
        if unsorted_count >= int(self.db.get_setting("cluster_min_size", "4") or 4):
            enqueue_job(self.db, "cluster", "ml", priority=10)

        pending = int(
            self.db.scalar(
                "SELECT COUNT(*) FROM images i WHERE "
                "(i.faces_at IS NULL OR i.embed_at IS NULL OR i.scene_at IS NULL) "
                "AND i.status != 'error' "
                "AND EXISTS (SELECT 1 FROM files f WHERE f.image_id = i.id AND f.missing_at IS NULL)"
            )
            or 0
        )
        if pending:
            enqueue_job(self.db, "analyze", "ml", priority=20, reuse_active=False)

        pending_thumbs = int(
            self.db.scalar(
                "SELECT COUNT(*) FROM images i WHERE i.thumb_at IS NULL AND i.status != 'error' "
                "AND EXISTS (SELECT 1 FROM files f WHERE f.image_id = i.id AND f.missing_at IS NULL)"
            )
            or 0
        )
        if pending_thumbs:
            enqueue_job(self.db, "thumbnail", "io", priority=30, reuse_active=False)

    def _mark_image_error(self, image_id: int, message: str) -> None:
        now = now_iso()
        self.db.execute(
            "UPDATE images SET status = 'error', error = ?, thumb_at = COALESCE(thumb_at, ?), "
            "faces_at = COALESCE(faces_at, ?), embed_at = COALESCE(embed_at, ?), "
            "scene_at = COALESCE(scene_at, ?) WHERE id = ?",
            (message[:1500], now, now, now, now, image_id),
        )

    # ---------------------------------------------------------------- assign
    def handle_assign(self, ctx: JobContext) -> None:
        confirmed = self.db.query(
            "SELECT person_id, embedding FROM faces WHERE person_id IS NOT NULL "
            "AND ignored_at IS NULL AND embedding_model = ?",
            (FACE_EMBEDDING_MODEL,),
        )
        if not confirmed:
            return

        matrix = np.vstack(
            [np.frombuffer(row["embedding"], dtype=np.float32) for row in confirmed]
        )
        labels = np.array([int(row["person_id"]) for row in confirmed], dtype=np.int64)
        unique_people = np.unique(labels)

        unassigned = self.db.query(
            "SELECT id, embedding FROM faces WHERE person_id IS NULL AND ignored_at IS NULL "
            "AND embedding_model = ?",
            (FACE_EMBEDDING_MODEL,),
        )
        if not unassigned:
            return

        total = len(unassigned)
        ctx.set_total(total, "faces")
        high = float(self.db.get_setting("knn_high", "0.50") or 0.50)
        low = float(self.db.get_setting("knn_low", "0.35") or 0.35)
        svm_bundle = self._load_active_classifier()

        # A face moved away from a person is a per-face cannot-link. It should
        # not be immediately reassigned to that same person by k-NN or SVM.
        blocked: dict[int, set[int]] = {}
        for correction in self.db.query(
            "SELECT fc.face_id, fc.old_person_id FROM face_corrections fc "
            "JOIN (SELECT face_id, MAX(id) AS max_id FROM face_corrections "
            "WHERE action = 'label' GROUP BY face_id) latest ON latest.max_id = fc.id "
            "WHERE fc.old_person_id IS NOT NULL "
            "AND (fc.new_person_id IS NULL OR fc.new_person_id != fc.old_person_id)"
        ):
            blocked.setdefault(int(correction["face_id"]), set()).add(
                int(correction["old_person_id"])
            )

        for index, row in enumerate(unassigned, start=1):
            ctx.checkpoint()
            face_id = int(row["id"])
            vector = np.frombuffer(row["embedding"], dtype=np.float32)
            scores = matrix @ vector
            person_scores = {
                int(person): float(scores[labels == person].max())
                for person in unique_people
                if int(person) not in blocked.get(face_id, set())
            }
            if not person_scores:
                ctx.progress(index, total, f"Assigning faces · {index}/{total}")
                continue
            best_person, best_score = max(person_scores.items(), key=lambda item: item[1])

            source = None
            confidence = best_score
            chosen = None
            if best_score >= high:
                chosen = best_person
                source = "knn"
            elif svm_bundle is not None and best_score < high:
                model, classes = svm_bundle
                try:
                    probabilities = model.predict_proba(vector.reshape(1, -1))[0]
                    class_index = int(np.argmax(probabilities))
                    svm_person = int(classes[class_index])
                    svm_score = float(probabilities[class_index])
                    threshold = float(
                        self.db.get_setting("classifier_threshold", "0.75") or 0.75
                    )
                    if (
                        svm_score >= threshold
                        and svm_person in person_scores
                        and (best_score < low or svm_person == best_person)
                    ):
                        chosen = svm_person
                        confidence = svm_score
                        source = "svm"
                except Exception:
                    pass

            if chosen is not None:
                self.db.execute(
                    "UPDATE faces SET person_id = ?, assignment_source = ?, "
                    "assignment_confidence = ?, updated_at = ? WHERE id = ?",
                    (chosen, source, confidence, now_iso(), row["id"]),
                )
            ctx.progress(index, total, f"Assigning faces · {index}/{total}")

    def _load_active_classifier(self):
        row = self.db.query_one(
            "SELECT * FROM classifier_runs WHERE active = 1 "
            "ORDER BY trained_at DESC LIMIT 1"
        )
        if row is None:
            return None
        try:
            with open(row["model_path"], "rb") as handle:
                bundle = pickle.load(handle)
            return bundle["model"], np.array(bundle["classes"], dtype=np.int64)
        except Exception:
            return None

    # --------------------------------------------------------------- cluster
    def handle_cluster(self, ctx: JobContext) -> None:
        from sklearn.cluster import HDBSCAN

        min_cluster_size = int(self.db.get_setting("cluster_min_size", "4") or 4)
        min_samples = int(self.db.get_setting("cluster_min_samples", "3") or 3)
        min_face_size = int(self.db.get_setting("face_min_size", "48") or 48)

        rows = self.db.query(
            "SELECT id, embedding FROM faces WHERE person_id IS NULL AND ignored_at IS NULL "
            "AND embedding_model = ? AND quality >= ?",
            (FACE_EMBEDDING_MODEL, min_face_size),
        )
        if len(rows) < min_cluster_size:
            return

        ctx.set_total(len(rows), "faces")
        ctx.progress(0, len(rows), "Clustering unsorted faces")
        matrix = np.vstack(
            [np.frombuffer(row["embedding"], dtype=np.float32) for row in rows]
        )
        face_ids = [int(row["id"]) for row in rows]

        run_cur = self.db.execute(
            "INSERT INTO cluster_runs (embedding_model, params_json, status, started_at) "
            "VALUES (?, ?, 'running', ?)",
            (
                FACE_EMBEDDING_MODEL,
                json.dumps(
                    {"min_cluster_size": min_cluster_size, "min_samples": min_samples}
                ),
                now_iso(),
            ),
        )
        run_id = int(run_cur.lastrowid)

        clusterer = HDBSCAN(
            min_cluster_size=min_cluster_size,
            min_samples=min_samples,
            metric="cosine",
            cluster_selection_method="eom",
        )
        labels = clusterer.fit_predict(matrix)

        self.db.execute(
            "UPDATE faces SET cluster_id = NULL WHERE person_id IS NULL"
        )
        cluster_count = 0
        noise_count = 0
        for label in sorted(set(int(value) for value in labels)):
            indices = [i for i, value in enumerate(labels) if int(value) == label]
            if label < 0:
                noise_count = len(indices)
                continue
            centroid = matrix[indices].mean(axis=0)
            cur = self.db.execute(
                "INSERT INTO clusters (run_id, label, size, centroid, created_at) "
                "VALUES (?, ?, ?, ?, ?)",
                (
                    run_id,
                    label,
                    len(indices),
                    centroid.astype(np.float32).tobytes(),
                    now_iso(),
                ),
            )
            cluster_id = int(cur.lastrowid)
            self.db.executemany(
                "UPDATE faces SET cluster_id = ? WHERE id = ?",
                [(cluster_id, face_ids[i]) for i in indices],
            )
            cluster_count += 1
            ctx.progress(
                min(len(rows), sum(1 for value in labels if int(value) >= 0)),
                len(rows),
                f"Clustering · {cluster_count} proposed people",
            )

        self.db.execute(
            "UPDATE cluster_runs SET face_count = ?, cluster_count = ?, noise_count = ?, "
            "status = 'done', finished_at = ? WHERE id = ?",
            (len(rows), cluster_count, noise_count, now_iso(), run_id),
        )
        ctx.progress(len(rows), len(rows), f"Clustered {len(rows)} faces into {cluster_count} proposals")

    # --------------------------------------------------------------- train
    def handle_train_classifier(self, ctx: JobContext) -> None:
        from sklearn.metrics import classification_report
        from sklearn.model_selection import train_test_split
        from sklearn.svm import SVC

        rows = self.db.query(
            "SELECT person_id, embedding FROM faces WHERE person_id IS NOT NULL "
            "AND ignored_at IS NULL AND embedding_model = ?",
            (FACE_EMBEDDING_MODEL,),
        )
        if not rows:
            raise ServiceError("No confirmed faces to train on")

        by_person: dict[int, list[np.ndarray]] = {}
        for row in rows:
            by_person.setdefault(int(row["person_id"]), []).append(
                np.frombuffer(row["embedding"], dtype=np.float32)
            )
        classes = sorted(pid for pid, items in by_person.items() if len(items) >= 2)
        if len(classes) < 2:
            raise ServiceError("Need at least two people with two faces each")

        x_values: list[np.ndarray] = []
        y_values: list[int] = []
        for person_id in classes:
            for vector in by_person[person_id][:200]:
                x_values.append(vector)
                y_values.append(person_id)

        x = np.vstack(x_values)
        y = np.array(y_values, dtype=np.int64)
        ctx.set_total(len(x), "faces")
        ctx.progress(0, len(x), "Training classifier")

        counts = Counter(y_values)
        can_stratify = len(x) >= 10 and min(counts.values()) >= 2
        metrics: dict[str, Any] = {}
        if can_stratify:
            x_train, x_test, y_train, y_test = train_test_split(
                x, y, test_size=0.2, random_state=1337, stratify=y
            )
        else:
            x_train, y_train = x, y
            x_test, y_test = None, None

        model = SVC(
            kernel="linear",
            probability=True,
            class_weight="balanced",
            C=1.0,
        )
        model.fit(x_train, y_train)

        if x_test is not None and y_test is not None:
            predictions = model.predict(x_test)
            report = classification_report(
                y_test, predictions, output_dict=True, zero_division=0
            )
            metrics = {
                "macro_f1": report.get("macro avg", {}).get("f1-score"),
                "accuracy": report.get("accuracy"),
                "support": len(y_test),
            }

        threshold = float(self.db.get_setting("classifier_threshold", "0.75") or 0.75)
        path = self.settings.models_dir / f"classifier_{int(time.time())}.pkl"
        with path.open("wb") as handle:
            pickle.dump(
                {
                    "model": model,
                    "classes": [int(value) for value in model.classes_],
                    "embedding_model": FACE_EMBEDDING_MODEL,
                    "threshold": threshold,
                },
                handle,
            )

        self.db.execute("UPDATE classifier_runs SET active = 0")
        self.db.execute(
            "INSERT INTO classifier_runs (model_path, classes_json, metrics_json, "
            "threshold, embedding_model, trained_at, active) VALUES (?, ?, ?, ?, ?, ?, 1)",
            (
                str(path),
                json.dumps([int(value) for value in model.classes_]),
                json.dumps(metrics),
                threshold,
                FACE_EMBEDDING_MODEL,
                now_iso(),
            ),
        )
        ctx.progress(len(x), len(x), f"Classifier trained on {len(classes)} people")

    # ---------------------------------------------------------- reembed face
    def handle_reembed_face(self, ctx: JobContext) -> None:
        face_id = int(ctx.payload.get("face_id") or 0)
        face = self.db.query_one("SELECT * FROM faces WHERE id = ?", (face_id,))
        if face is None:
            return
        image = self.db.query_one("SELECT * FROM images WHERE id = ?", (face["image_id"],))
        if image is None:
            return
        file_row = _canonical_file(self.db, int(face["image_id"]))
        if file_row is None:
            return
        source = self.db.query_one(
            "SELECT path FROM sources WHERE id = ?", (file_row["source_id"],)
        )
        if source is None:
            return
        asset = load_image_asset(Path(source["path"]) / file_row["rel_path"])
        detections = self.ml.faces.analyze(asset.image, 0)
        target = (
            float(face["bbox_x1"]),
            float(face["bbox_y1"]),
            float(face["bbox_x2"]),
            float(face["bbox_y2"]),
        )

        def iou(other: tuple[float, float, float, float]) -> float:
            x1 = max(target[0], other[0])
            y1 = max(target[1], other[1])
            x2 = min(target[2], other[2])
            y2 = min(target[3], other[3])
            intersection = max(0.0, x2 - x1) * max(0.0, y2 - y1)
            area_a = max(0.0, target[2] - target[0]) * max(0.0, target[3] - target[1])
            area_b = max(0.0, other[2] - other[0]) * max(0.0, other[3] - other[1])
            union = area_a + area_b - intersection
            return intersection / union if union > 0 else 0.0

        best = max(detections, key=lambda item: iou(item.bbox), default=None)
        if best is None or iou(best.bbox) < 0.25:
            ctx.log_error(
                "The corrected box did not match a detectable face; embedding left unchanged",
                "face",
                face_id,
            )
            return

        self.db.execute(
            "UPDATE faces SET embedding = ?, embedding_model = ?, det_score = ?, "
            "quality = ?, updated_at = ? WHERE id = ?",
            (
                best.embedding.astype(np.float32).tobytes(),
                FACE_EMBEDDING_MODEL,
                best.det_score,
                best.quality,
                now_iso(),
                face_id,
            ),
        )
        try:
            save_face_crop(asset.image, target, face_id, self.settings.faces_dir)
        except Exception:
            pass
        if face["person_id"] is None:
            enqueue_job(self.db, "assign", "ml", priority=15)
        ctx.progress(1, 1, "Face re-embedded")

    # --------------------------------------------------------------- export
    def export_preview(self, destination: str) -> dict[str, Any]:
        destination_path = self._validate_destination(destination)
        rows = self.db.query(
            "SELECT i.* FROM images i WHERE EXISTS "
            "(SELECT 1 FROM files f WHERE f.image_id = i.id AND f.missing_at IS NULL) "
            "ORDER BY i.id"
        )
        copies = 0
        total_bytes = 0
        total_photos = 0
        multi_person = 0
        collisions = 0
        by_branch = {
            "people": 0,
            "peopleUnsorted": 0,
            "documents": 0,
            "unknown": 0,
        }
        used: Counter[str] = Counter()

        for image in rows:
            file_row = _canonical_file(self.db, int(image["id"]))
            if file_row is None:
                continue
            total_photos += 1
            people = _image_people(self.db, int(image["id"]))
            document = _document_label(self.db, int(image["id"]))
            face_count = _face_count(self.db, int(image["id"]))
            targets: list[tuple[str, str]] = []
            if people:
                if len(people) > 1:
                    multi_person += 1
                for person in people:
                    targets.append(("people", f"People/{_safe_name(person['name'])}"))
            elif face_count > 0:
                targets.append(("peopleUnsorted", "People/Unsorted"))
            elif document:
                targets.append(("documents", f"Documents/{_safe_name(document)}"))
            else:
                targets.append(("unknown", "Unknown"))

            for branch, folder in targets:
                relative = folder + "/" + Path(file_row["rel_path"]).name
                if used[relative]:
                    collisions += 1
                used[relative] += 1
                by_branch[branch] += 1
                copies += 1
                total_bytes += int(file_row["size"])

        free = shutil.disk_usage(destination_path.parent).free
        warnings: list[str] = []
        if multi_person:
            warnings.append(
                f"{multi_person} photos contain multiple people and will be copied once per person."
            )
        if total_bytes > free:
            warnings.append("Not enough free space for this export.")

        return {
            "destination": str(destination_path),
            "totalPhotos": total_photos,
            "copies": copies,
            "bytes": total_bytes,
            "byBranch": by_branch,
            "multiPersonPhotos": multi_person,
            "collisions": collisions,
            "freeSpace": free,
            "warnings": warnings,
        }

    def _validate_destination(self, destination: str) -> Path:
        path = Path(destination).expanduser().resolve()
        data_dir = self.settings.data_dir.resolve()
        if path == data_dir or data_dir in path.parents:
            raise ServiceError("Export destination cannot be inside the app data directory")
        for source in _source_paths(self.db):
            source = source.resolve()
            if path == source or source in path.parents:
                raise ServiceError("Export destination cannot be inside a source folder")
        if path.exists() and not path.is_dir():
            raise ServiceError("Export destination is not a folder")
        if path.exists() and any(path.iterdir()):
            if not (path / ".clusterlens" / "export.json").exists():
                raise ServiceError(
                    "Destination is not empty and was not created by ClusterLens"
                )
        path.parent.mkdir(parents=True, exist_ok=True)
        return path

    def handle_export(self, ctx: JobContext) -> None:
        export_id = int(ctx.payload.get("export_id") or 0)
        row = self.db.query_one("SELECT * FROM exports WHERE id = ?", (export_id,))
        if row is None:
            raise ServiceError("Export not found")
        destination = Path(row["destination"])
        self._validate_destination(str(destination))
        destination.mkdir(parents=True, exist_ok=True)
        marker_dir = destination / ".clusterlens"
        marker_dir.mkdir(parents=True, exist_ok=True)
        (marker_dir / "export.json").write_text(
            json.dumps({"id": export_id, "created_at": row["created_at"]}, indent=2),
            encoding="utf-8",
        )
        manifest_path = marker_dir / "manifest.jsonl"

        self.db.execute(
            "UPDATE exports SET status = 'running', started_at = ? WHERE id = ?",
            (now_iso(), export_id),
        )
        total = int(row["total_files"] or 0)
        total_bytes = int(row["total_bytes"] or 0)
        ctx.set_total(total, "bytes")
        copied = 0
        copied_bytes = 0
        used_paths: set[str] = set()

        images = self.db.query(
            "SELECT i.* FROM images i WHERE EXISTS "
            "(SELECT 1 FROM files f WHERE f.image_id = i.id AND f.missing_at IS NULL) "
            "ORDER BY i.id"
        )
        with manifest_path.open("w", encoding="utf-8") as manifest:
            for image in images:
                ctx.checkpoint()
                image_id = int(image["id"])
                file_row = _canonical_file(self.db, image_id)
                if file_row is None:
                    continue
                source = self.db.query_one(
                    "SELECT path FROM sources WHERE id = ?", (file_row["source_id"],)
                )
                if source is None:
                    continue
                source_path = Path(source["path"]) / file_row["rel_path"]
                if not source_path.exists():
                    continue

                people = _image_people(self.db, image_id)
                document = _document_label(self.db, image_id)
                face_count = _face_count(self.db, image_id)
                targets: list[tuple[str, str, int | None]] = []
                if people:
                    for person in people:
                        targets.append(
                            ("People/" + _safe_name(person["name"]), person["name"], person["id"])
                        )
                elif face_count > 0:
                    targets.append(("People/Unsorted", "Unsorted", None))
                elif document:
                    targets.append((f"Documents/{_safe_name(document)}", document, None))
                else:
                    targets.append(("Unknown", "Unknown", None))

                for folder, label, person_id in targets:
                    filename = _safe_name(source_path.name, "photo")
                    relative = f"{folder}/{filename}"
                    if relative in used_paths or (destination / relative).exists():
                        stem = Path(filename).stem
                        suffix = Path(filename).suffix
                        relative = f"{folder}/{stem}__{image['content_hash'][:8]}{suffix}"
                    used_paths.add(relative)

                    existing = self.db.query_one(
                        "SELECT status FROM export_items WHERE export_id = ? AND relative_path = ?",
                        (export_id, relative),
                    )
                    if existing and existing["status"] == "done":
                        continue

                    target_path = destination / relative
                    target_path.parent.mkdir(parents=True, exist_ok=True)
                    temp_path = target_path.with_name(target_path.name + ".tmp")
                    try:
                        shutil.copy2(source_path, temp_path)
                        os.replace(temp_path, target_path)
                    except Exception as exc:
                        self.db.execute(
                            "INSERT OR REPLACE INTO export_items "
                            "(export_id, image_id, person_id, relative_path, bytes, status, error, created_at) "
                            "VALUES (?, ?, ?, ?, ?, 'error', ?, ?)",
                            (
                                export_id,
                                image_id,
                                person_id,
                                relative,
                                int(file_row["size"]),
                                str(exc)[:500],
                                now_iso(),
                            ),
                        )
                        ctx.log_error(str(exc), "export", image_id)
                        continue

                    self.db.execute(
                        "INSERT OR REPLACE INTO export_items "
                        "(export_id, image_id, person_id, relative_path, bytes, status, error, created_at) "
                        "VALUES (?, ?, ?, ?, ?, 'done', NULL, ?)",
                        (
                            export_id,
                            image_id,
                            person_id,
                            relative,
                            int(file_row["size"]),
                            now_iso(),
                        ),
                    )
                    source_occurrences = [
                        str(Path(r["rel_path"]))
                        for r in self.db.query(
                            "SELECT rel_path FROM files WHERE image_id = ? AND missing_at IS NULL",
                            (image_id,),
                        )
                    ]
                    manifest.write(
                        json.dumps(
                            {
                                "image_id": image_id,
                                "export_path": relative,
                                "label": label,
                                "person_id": person_id,
                                "content_hash": image["content_hash"],
                                "date_taken": image["date_taken"],
                                "sources": source_occurrences,
                                "bytes": int(file_row["size"]),
                            },
                            ensure_ascii=False,
                        )
                        + "\n"
                    )
                    copied += 1
                    copied_bytes += int(file_row["size"])
                    self.db.execute(
                        "UPDATE exports SET copied_files = ?, copied_bytes = ? WHERE id = ?",
                        (copied, copied_bytes, export_id),
                    )
                    ctx.progress(
                        min(total_bytes, copied_bytes),
                        total_bytes,
                        f"Copying {copied}/{total} files",
                    )

        self.db.execute(
            "UPDATE exports SET status = 'done', finished_at = ?, copied_files = ?, "
            "copied_bytes = ?, manifest_path = ?, error = ? WHERE id = ?",
            (
                now_iso(),
                copied,
                copied_bytes,
                str(manifest_path),
                f"{copied} copies" if copied else None,
                export_id,
            ),
        )

    # ---------------------------------------------------------------- search
    def image_search(
        self,
        query: str,
        *,
        person_id: int | None = None,
        scene: str | None = None,
        source_id: int | None = None,
        year: str | None = None,
        document: bool | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[tuple[int, float]], int]:
        if not query.strip():
            raise ServiceError("Query is empty")
        embeddings = self.db.query(
            "SELECT image_id, vector FROM image_embeddings WHERE model = ?",
            (self.settings.image_model,),
        )
        if not embeddings:
            raise ModelNotReady("Image embeddings are not ready yet")

        ids = np.array([int(row["image_id"]) for row in embeddings], dtype=np.int64)
        matrix = np.vstack(
            [np.frombuffer(row["vector"], dtype=np.float32) for row in embeddings]
        )
        try:
            query_vector = self.ml.images.embed_texts([query])[0]
        except Exception as exc:
            raise ModelNotReady(f"Search model unavailable: {exc}") from exc

        scores = matrix @ query_vector
        allowed = self._filtered_image_ids(
            person_id=person_id, scene=scene, source_id=source_id, year=year, document=document
        )
        if allowed is not None:
            mask = np.isin(ids, list(allowed))
            scores = scores[mask]
            ids = ids[mask]
        order = np.argsort(-scores)
        total = len(order)
        selected = order[offset : offset + limit]
        return [(int(ids[i]), float(scores[i])) for i in selected], total

    def _filtered_image_ids(
        self,
        *,
        person_id: int | None,
        scene: str | None,
        source_id: int | None,
        year: str | None,
        document: bool | None = None,
    ) -> set[int] | None:
        clauses: list[str] = []
        params: list[Any] = []
        if person_id is not None:
            clauses.append("EXISTS (SELECT 1 FROM faces f WHERE f.image_id = i.id AND f.person_id = ?)")
            params.append(person_id)
        if scene:
            clauses.append("EXISTS (SELECT 1 FROM scene_labels s WHERE s.image_id = i.id AND s.label = ?)")
            params.append(scene)
        if source_id is not None:
            clauses.append("EXISTS (SELECT 1 FROM files f WHERE f.image_id = i.id AND f.source_id = ?)")
            params.append(source_id)
        if year:
            clauses.append("i.date_taken LIKE ?")
            params.append(f"{year}%")
        if document is not None:
            placeholders = ",".join("?" for _ in DOCUMENT_LABELS)
            clauses.append(
                ("EXISTS" if document else "NOT EXISTS")
                + " (SELECT 1 FROM scene_labels s WHERE s.image_id = i.id "
                + f"AND s.is_primary = 1 AND s.label IN ({placeholders}))"
            )
            params.extend(DOCUMENT_LABELS)
        if not clauses:
            return None
        rows = self.db.query(
            "SELECT i.id FROM images i WHERE " + " AND ".join(clauses), tuple(params)
        )
        return {int(row["id"]) for row in rows}

    # ----------------------------------------------------------------- stats
    def stats(self) -> dict[str, Any]:
        counts = {
            "images": int(self.db.scalar("SELECT COUNT(*) FROM images") or 0),
            "visibleImages": int(
                self.db.scalar(
                    "SELECT COUNT(*) FROM images WHERE thumb_at IS NOT NULL"
                )
                or 0
            ),
            "pendingImages": int(
                self.db.scalar(
                    "SELECT COUNT(*) FROM images WHERE thumb_at IS NULL"
                )
                or 0
            ),
            "faces": int(
                self.db.scalar("SELECT COUNT(*) FROM faces WHERE ignored_at IS NULL") or 0
            ),
            "people": int(self.db.scalar("SELECT COUNT(*) FROM people") or 0),
            "unsortedFaces": int(
                self.db.scalar(
                    "SELECT COUNT(*) FROM faces WHERE person_id IS NULL AND ignored_at IS NULL"
                )
                or 0
            ),
            "scenes": int(
                self.db.scalar("SELECT COUNT(DISTINCT label) FROM scene_labels") or 0
            ),
            "documents": int(
                self.db.scalar(
                    "SELECT COUNT(DISTINCT image_id) FROM scene_labels "
                    f"WHERE is_primary = 1 AND label IN ({','.join('?' for _ in DOCUMENT_LABELS)})",
                    DOCUMENT_LABELS,
                )
                or 0
            ),
            "sources": int(self.db.scalar("SELECT COUNT(*) FROM sources") or 0),
            "proposals": int(
                self.db.scalar(
                    "SELECT COUNT(*) FROM clusters c JOIN cluster_runs r ON r.id = c.run_id "
                    "WHERE r.id = (SELECT MAX(id) FROM cluster_runs) AND c.ignored = 0 "
                    "AND c.accepted_person_id IS NULL"
                )
                or 0
            ),
        }
        return counts
