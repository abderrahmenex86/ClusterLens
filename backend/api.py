from __future__ import annotations

import asyncio
import json
import os
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field, field_validator

from .db import now_iso
from .jobs import (
    enqueue_job,
    request_cancel,
    request_pause,
    request_resume,
)
from .ml import load_image_asset, save_thumbnails
from .services import ModelNotReady, ServiceError


router = APIRouter(prefix="/api")


def db(request: Request):
    return request.app.state.db


def services(request: Request):
    return request.app.state.services


def settings(request: Request):
    return request.app.state.settings


def _source_row(row: Any, database) -> dict[str, Any]:
    source_id = int(row["id"])
    counts = database.query_one(
        "SELECT COUNT(*) AS files, "
        "SUM(CASE WHEN f.image_id IS NOT NULL THEN 1 ELSE 0 END) AS images "
        "FROM files f WHERE f.source_id = ? AND f.missing_at IS NULL",
        (source_id,),
    )
    face_count = database.scalar(
        "SELECT COUNT(DISTINCT fa.id) FROM faces fa JOIN files f ON f.image_id = fa.image_id "
        "WHERE f.source_id = ? AND f.missing_at IS NULL",
        (source_id,),
    )
    return {
        "id": source_id,
        "label": row["label"],
        "path": row["path"],
        "recursive": bool(row["recursive"]),
        "enabled": bool(row["enabled"]),
        "status": row["status"],
        "imageCount": int(counts["images"] or 0) if counts else 0,
        "fileCount": int(counts["files"] or 0) if counts else 0,
        "faceCount": int(face_count or 0),
        "lastScanAt": row["last_scan_at"],
        "lastError": row["last_error"],
    }


def _job_row(row: Any, database) -> dict[str, Any]:
    total = int(row["progress_total"] or 0)
    current = int(row["progress_current"] or 0)
    source_label = None
    if row["source_id"] is not None:
        source_label = database.scalar(
            "SELECT label FROM sources WHERE id = ?", (row["source_id"],)
        )
    return {
        "id": int(row["id"]),
        "type": row["type"],
        "queue": row["queue"],
        "status": row["status"],
        "sourceId": row["source_id"],
        "sourceLabel": source_label,
        "progress": {
            "current": current,
            "total": total,
            "unit": row["progress_unit"],
            "percent": round((current / total) * 100, 1) if total > 0 else 0,
        },
        "errorCount": int(row["error_count"] or 0),
        "createdAt": row["created_at"],
        "startedAt": row["started_at"],
        "finishedAt": row["finished_at"],
        "error": row["error"],
    }


def _face_row(row: Any, include_person: bool = True) -> dict[str, Any]:
    person = None
    if include_person and row["person_id"] is not None:
        person = {"id": int(row["person_id"]), "name": row["person_name"]}
    return {
        "id": int(row["id"]),
        "imageId": int(row["image_id"]),
        "bbox": [
            float(row["bbox_x1"]),
            float(row["bbox_y1"]),
            float(row["bbox_x2"]),
            float(row["bbox_y2"]),
        ],
        "detScore": row["det_score"],
        "assignmentSource": row["assignment_source"],
        "assignmentConfidence": row["assignment_confidence"],
        "bboxSource": row["bbox_source"],
        "ignored": row["ignored_at"] is not None,
        "person": person,
        "thumbUrl": f"/api/faces/{int(row['id'])}/thumb",
    }


def _person_row(row: Any, database) -> dict[str, Any]:
    person_id = int(row["id"])
    counts = database.query_one(
        "SELECT COUNT(*) AS faces, COUNT(DISTINCT image_id) AS images "
        "FROM faces WHERE person_id = ? AND ignored_at IS NULL",
        (person_id,),
    )
    cover = row["cover_face_id"]
    if cover is None:
        cover_row = database.query_one(
            "SELECT id FROM faces WHERE person_id = ? AND ignored_at IS NULL "
            "ORDER BY det_score DESC LIMIT 1",
            (person_id,),
        )
        cover = cover_row["id"] if cover_row else None
    return {
        "id": person_id,
        "name": row["name"],
        "faceCount": int(counts["faces"] or 0) if counts else 0,
        "imageCount": int(counts["images"] or 0) if counts else 0,
        "coverFaceId": cover,
        "coverUrl": f"/api/faces/{cover}/thumb" if cover else None,
        "createdAt": row["created_at"],
    }


def _image_row(row: Any, database, base_url: str = "") -> dict[str, Any]:
    image_id = int(row["id"])
    people = database.query(
        "SELECT DISTINCT p.id, p.name FROM faces f JOIN people p ON p.id = f.person_id "
        "WHERE f.image_id = ? AND f.person_id IS NOT NULL AND f.ignored_at IS NULL",
        (image_id,),
    )
    scenes = database.query(
        "SELECT label, score, is_primary FROM scene_labels WHERE image_id = ? "
        "ORDER BY is_primary DESC, score DESC",
        (image_id,),
    )
    sources = database.query(
        "SELECT DISTINCT s.label FROM files f JOIN sources s ON s.id = f.source_id "
        "WHERE f.image_id = ? AND f.missing_at IS NULL",
        (image_id,),
    )
    face_count = int(
        database.scalar(
            "SELECT COUNT(*) FROM faces WHERE image_id = ? AND ignored_at IS NULL",
            (image_id,),
        )
        or 0
    )
    unsorted = int(
        database.scalar(
            "SELECT COUNT(*) FROM faces WHERE image_id = ? AND person_id IS NULL "
            "AND ignored_at IS NULL",
            (image_id,),
        )
        or 0
    )
    primary = next((s["label"] for s in scenes if s["is_primary"]), None)
    return {
        "id": image_id,
        "thumbnailUrl": f"/api/images/{image_id}/preview?size=256",
        "previewUrl": f"/api/images/{image_id}/preview?size=1024",
        "width": row["width"],
        "height": row["height"],
        "dateTaken": row["date_taken"],
        "dateSource": row["date_source"],
        "people": [
            {"id": int(person["id"]), "name": person["name"]} for person in people
        ],
        "primaryScene": primary,
        "scenes": [
            {"label": scene["label"], "score": scene["score"], "primary": bool(scene["is_primary"])}
            for scene in scenes
        ],
        "sources": [source["label"] for source in sources],
        "faceCount": face_count,
        "unsortedFaceCount": unsorted,
        "status": row["status"],
    }


class SourceCreate(BaseModel):
    paths: list[str] = Field(min_length=1)
    labels: dict[str, str] = Field(default_factory=dict)
    recursive: bool = True


class SourcePatch(BaseModel):
    label: str | None = None
    enabled: bool | None = None
    recursive: bool | None = None


class RelinkRequest(BaseModel):
    path: str


class FacePatch(BaseModel):
    person_id: int | None = None
    bbox: list[float] | None = None
    ignored: bool | None = None

    @field_validator("bbox")
    @classmethod
    def validate_bbox(cls, value: list[float] | None):
        if value is None:
            return value
        if len(value) != 4:
            raise ValueError("bbox must have four numbers")
        if not all(0 <= item <= 1 for item in value):
            raise ValueError("bbox values must be between 0 and 1")
        if value[2] <= value[0] or value[3] <= value[1]:
            raise ValueError("bbox must have positive width and height")
        return value


class FaceBulk(BaseModel):
    face_ids: list[int]
    action: str
    person_id: int | None = None


class PersonCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    face_ids: list[int] = Field(default_factory=list)


class PersonPatch(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class PersonMerge(BaseModel):
    source_id: int
    target_id: int


class PersonSplit(BaseModel):
    face_ids: list[int]
    name: str = Field(min_length=1, max_length=100)


class ClusterAccept(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    merge_into_person_id: int | None = None


class ExportCreate(BaseModel):
    destination: str = Field(min_length=1)


class SettingsPatch(BaseModel):
    values: dict[str, Any]


class PickFolders(BaseModel):
    multiple: bool = False
    multiple_separator: str = "\n"


class ResetRequest(BaseModel):
    keep_sources: bool = True
    rescan: bool = True


def _validate_name(database, name: str, exclude_id: int | None = None) -> str:
    cleaned = name.strip()
    if not cleaned:
        raise ServiceError("Name cannot be empty")
    key = cleaned.casefold()
    row = database.query_one("SELECT id FROM people WHERE name_key = ?", (key,))
    if row and int(row["id"]) != exclude_id:
        raise ServiceError("A person with that name already exists")
    return cleaned


# ------------------------------------------------------------------ system
@router.get("/health")
def health(request: Request):
    return {"status": "ok", "version": "2.0.0"}


@router.get("/system/info")
def system_info(request: Request):
    database = db(request)
    app_settings = settings(request)
    usage = shutil.disk_usage(app_settings.data_dir)
    return {
        "version": "2.0.0",
        "dataDir": str(app_settings.data_dir),
        "database": str(app_settings.db_path),
        "imageModel": app_settings.image_model,
        "imageModelDim": app_settings.image_model_dim,
        "embeddingsEnabled": app_settings.embeddings_enabled,
        "disk": {
            "total": usage.total,
            "free": usage.free,
            "used": usage.used,
        },
        "stats": services(request).stats(),
    }


@router.post("/system/reset")
def reset_library(payload: ResetRequest, request: Request):
    database = db(request)
    active = int(
        database.scalar(
            "SELECT COUNT(*) FROM jobs WHERE status IN ('queued','running','paused')"
        )
        or 0
    )
    if active:
        raise HTTPException(409, "Pause or cancel active jobs before resetting")

    app_settings = settings(request)
    data_dir = app_settings.data_dir.resolve()
    for cache_dir in (
        app_settings.thumbs_dir,
        app_settings.faces_dir,
        app_settings.models_dir,
    ):
        resolved = cache_dir.resolve()
        if resolved == data_dir or not resolved.is_relative_to(data_dir):
            raise HTTPException(500, "Refusing to remove a cache outside the app data directory")
        if resolved.exists():
            shutil.rmtree(resolved)
        resolved.mkdir(parents=True, exist_ok=True)

    tables = [
        "export_items",
        "exports",
        "job_errors",
        "jobs",
        "face_corrections",
        "faces",
        "clusters",
        "cluster_runs",
        "scene_labels",
        "image_embeddings",
        "files",
        "images",
        "people",
        "classifier_runs",
    ]
    with database.transaction() as conn:
        for table in tables:
            conn.execute(f"DELETE FROM {table}")
        if payload.keep_sources:
            conn.execute(
                "UPDATE sources SET status = 'idle', last_error = NULL, last_scan_at = NULL"
            )
            reset_tables = [table for table in tables if table != "sources"]
        else:
            conn.execute("DELETE FROM sources")
            reset_tables = tables + ["sources"]
        placeholders = ",".join("?" for _ in reset_tables)
        conn.execute(
            f"DELETE FROM sqlite_sequence WHERE name IN ({placeholders})",
            reset_tables,
        )

    jobs: list[int] = []
    if payload.keep_sources and payload.rescan:
        for source in database.query("SELECT id FROM sources WHERE enabled = 1"):
            job_id, _ = enqueue_job(
                database,
                "scan",
                "io",
                source_id=int(source["id"]),
                payload={"source_id": int(source["id"])},
                priority=50,
            )
            jobs.append(job_id)

    try:
        database.execute("VACUUM")
    except Exception:
        pass

    return {
        "status": "ok",
        "keptSources": bool(payload.keep_sources),
        "jobs": jobs,
        "message": "Index and caches cleared. Source files and exported folders were not touched.",
    }


@router.get("/settings")
def get_settings(request: Request):
    database = db(request)
    rows = database.query("SELECT key, value FROM settings ORDER BY key")
    return {row["key"]: row["value"] for row in rows}


@router.patch("/settings")
def patch_settings(payload: SettingsPatch, request: Request):
    database = db(request)
    allowed = {
        "auto_retrain_after",
        "classifier_threshold",
        "cluster_min_size",
        "cluster_min_samples",
        "face_min_det_score",
        "face_min_size",
        "knn_high",
        "knn_low",
        "watcher_enabled",
        "scenes_enabled",
    }
    for key, value in payload.values.items():
        if key not in allowed:
            continue
        database.set_setting(key, str(value))
    rows = database.query("SELECT key, value FROM settings ORDER BY key")
    return {row["key"]: row["value"] for row in rows}


@router.get("/models")
def models(request: Request):
    database = db(request)
    classifier = database.query_one(
        "SELECT * FROM classifier_runs WHERE active = 1 ORDER BY trained_at DESC LIMIT 1"
    )
    embedding_count = int(
        database.scalar("SELECT COUNT(*) FROM image_embeddings") or 0
    )
    face_count = int(database.scalar("SELECT COUNT(*) FROM faces") or 0)
    return {
        "faces": {"model": "insightface_buffalo_l", "faces": face_count},
        "images": {
            "model": settings(request).image_model,
            "embeddings": embedding_count,
            "enabled": settings(request).embeddings_enabled,
        },
        "classifier": None
        if classifier is None
        else {
            "trainedAt": classifier["trained_at"],
            "metrics": json.loads(classifier["metrics_json"] or "{}"),
            "threshold": classifier["threshold"],
            "classes": json.loads(classifier["classes_json"]),
        },
    }


@router.post("/system/pick-folders")
def pick_folders(payload: PickFolders):
    zenity = shutil.which("zenity")
    if not zenity:
        raise HTTPException(
            501,
            "Native folder picker is not available. Install zenity or type a path.",
        )
    command = [zenity, "--file-selection", "--directory"]
    if payload.multiple:
        command += ["--multiple", f"--separator={payload.multiple_separator}"]
    try:
        result = subprocess.run(
            command, capture_output=True, text=True, timeout=600, check=False
        )
    except subprocess.TimeoutExpired:
        raise HTTPException(408, "Folder picker timed out")
    if result.returncode != 0:
        return {"paths": []}
    paths = [
        line.strip()
        for line in result.stdout.split(payload.multiple_separator)
        if line.strip()
    ]
    return {"paths": paths}


@router.get("/system/browse")
def browse_directories(request: Request, path: str | None = None):
    home = Path.home().resolve()
    target = Path(path).expanduser().resolve() if path else home
    if target != home and home not in target.parents:
        raise HTTPException(403, "Browsing is limited to your home directory")
    if not target.is_dir():
        raise HTTPException(404, "Directory not found")
    directories = []
    try:
        for entry in sorted(target.iterdir(), key=lambda p: p.name.lower()):
            if entry.name.startswith(".") or not entry.is_dir():
                continue
            directories.append({"name": entry.name, "path": str(entry)})
    except PermissionError:
        raise HTTPException(403, "Permission denied")
    return {"path": str(target), "parent": str(target.parent), "directories": directories}


@router.post("/system/open-folder")
def open_folder(request: Request, body: dict[str, str]):
    database = db(request)
    path = Path(body.get("path", "")).expanduser().resolve()
    exported = database.query_one(
        "SELECT id FROM exports WHERE destination = ? LIMIT 1", (str(path),)
    )
    if exported is None:
        raise HTTPException(403, "Only export folders can be opened")
    opener = shutil.which("xdg-open")
    if not opener:
        raise HTTPException(501, "xdg-open is not available")
    subprocess.Popen([opener, str(path)])
    return {"status": "ok"}


# ----------------------------------------------------------------- sources
@router.get("/sources")
def list_sources(request: Request):
    database = db(request)
    rows = database.query("SELECT * FROM sources ORDER BY created_at ASC")
    return {"items": [_source_row(row, database) for row in rows]}


def _validate_new_source(database, path: Path, data_dir: Path) -> None:
    resolved = path.expanduser().resolve()
    if not resolved.exists() or not resolved.is_dir():
        raise ServiceError(f"Not a directory: {resolved}")
    if resolved == data_dir or data_dir in resolved.parents:
        raise ServiceError("A source cannot be inside the app data directory")
    for row in database.query("SELECT path FROM sources"):
        existing = Path(row["path"]).resolve()
        if resolved == existing:
            raise ServiceError(f"Folder is already a source: {resolved}")
        if existing in resolved.parents:
            raise ServiceError(f"Folder is inside an existing source: {existing}")
        if resolved in existing.parents:
            raise ServiceError(f"Folder contains an existing source: {existing}")


@router.post("/sources", status_code=201)
def create_sources(payload: SourceCreate, request: Request):
    database = db(request)
    app_settings = settings(request)
    prepared: list[tuple[Path, str]] = []
    for raw in payload.paths:
        path = Path(raw).expanduser()
        try:
            _validate_new_source(database, path, app_settings.data_dir)
        except ServiceError as exc:
            raise HTTPException(422, str(exc))
        resolved = path.resolve()
        label = (payload.labels.get(raw) or resolved.name or "Source").strip()
        prepared.append((resolved, label))

    created = []
    jobs = []
    for resolved, label in prepared:
        cur = database.execute(
            "INSERT INTO sources (label, path, recursive, status, created_at) "
            "VALUES (?, ?, ?, 'idle', ?)",
            (label, str(resolved), 1 if payload.recursive else 0, now_iso()),
        )
        source_id = int(cur.lastrowid)
        job_id, _ = enqueue_job(
            database,
            "scan",
            "io",
            source_id=source_id,
            payload={"source_id": source_id},
            priority=50,
        )
        jobs.append(job_id)
        created.append(source_id)

    rows = database.query(
        f"SELECT * FROM sources WHERE id IN ({','.join('?' for _ in created)})",
        tuple(created),
    )
    return {
        "sources": [_source_row(row, database) for row in rows],
        "jobs": jobs,
    }


@router.patch("/sources/{source_id}")
def patch_source(source_id: int, payload: SourcePatch, request: Request):
    database = db(request)
    row = database.query_one("SELECT * FROM sources WHERE id = ?", (source_id,))
    if row is None:
        raise HTTPException(404, "Source not found")
    fields = []
    params: list[Any] = []
    if payload.label is not None:
        fields.append("label = ?")
        params.append(payload.label.strip() or row["label"])
    if payload.enabled is not None:
        fields.append("enabled = ?")
        params.append(1 if payload.enabled else 0)
    if payload.recursive is not None:
        fields.append("recursive = ?")
        params.append(1 if payload.recursive else 0)
    if fields:
        params.append(source_id)
        database.execute(f"UPDATE sources SET {', '.join(fields)} WHERE id = ?", params)
    updated = database.query_one("SELECT * FROM sources WHERE id = ?", (source_id,))
    return _source_row(updated, database)


@router.delete("/sources/{source_id}")
def delete_source(source_id: int, request: Request, forget: bool = False):
    database = db(request)
    row = database.query_one("SELECT * FROM sources WHERE id = ?", (source_id,))
    if row is None:
        raise HTTPException(404, "Source not found")
    database.execute("DELETE FROM sources WHERE id = ?", (source_id,))
    if forget:
        database.execute(
            "DELETE FROM images WHERE id NOT IN "
            "(SELECT image_id FROM files WHERE image_id IS NOT NULL)"
        )
    return {"status": "ok"}


@router.post("/sources/{source_id}/scan")
def rescan_source(source_id: int, request: Request):
    database = db(request)
    row = database.query_one("SELECT * FROM sources WHERE id = ?", (source_id,))
    if row is None:
        raise HTTPException(404, "Source not found")
    job_id, _ = enqueue_job(
        database,
        "scan",
        "io",
        source_id=source_id,
        payload={"source_id": source_id},
        priority=50,
    )
    return {"jobId": job_id}


@router.post("/sources/{source_id}/relink")
def relink_source(source_id: int, payload: RelinkRequest, request: Request):
    database = db(request)
    row = database.query_one("SELECT * FROM sources WHERE id = ?", (source_id,))
    if row is None:
        raise HTTPException(404, "Source not found")
    path = Path(payload.path).expanduser().resolve()
    if not path.exists() or not path.is_dir():
        raise HTTPException(422, "New path is not a directory")
    database.execute(
        "UPDATE sources SET path = ?, status = 'idle', last_error = NULL WHERE id = ?",
        (str(path), source_id),
    )
    job_id, _ = enqueue_job(
        database,
        "scan",
        "io",
        source_id=source_id,
        payload={"source_id": source_id},
        priority=50,
    )
    return {"status": "ok", "jobId": job_id}


# -------------------------------------------------------------------- jobs
@router.get("/jobs")
def list_jobs(
    request: Request,
    status: str | None = None,
    type: str | None = None,
    source_id: int | None = None,
    limit: int = Query(100, ge=1, le=500),
):
    database = db(request)
    clauses = []
    params: list[Any] = []
    if status:
        clauses.append("status = ?")
        params.append(status)
    if type:
        clauses.append("type = ?")
        params.append(type)
    if source_id is not None:
        clauses.append("source_id = ?")
        params.append(source_id)
    where = " WHERE " + " AND ".join(clauses) if clauses else ""
    rows = database.query(
        f"SELECT * FROM jobs{where} ORDER BY created_at DESC, id DESC LIMIT ?",
        tuple(params + [limit]),
    )
    return {"items": [_job_row(row, database) for row in rows]}


@router.post("/jobs/analyze")
def analyze_now(request: Request):
    job_id, _ = enqueue_job(
        db(request), "analyze", "ml", priority=20, reuse_active=False
    )
    return {"jobId": job_id}


@router.get("/jobs/{job_id}")
def get_job(job_id: int, request: Request):
    database = db(request)
    row = database.query_one("SELECT * FROM jobs WHERE id = ?", (job_id,))
    if row is None:
        raise HTTPException(404, "Job not found")
    return _job_row(row, database)


@router.get("/jobs/{job_id}/items")
def job_items(job_id: int, request: Request, limit: int = Query(200, ge=1, le=1000)):
    database = db(request)
    rows = database.query(
        "SELECT * FROM job_errors WHERE job_id = ? ORDER BY created_at DESC LIMIT ?",
        (job_id, limit),
    )
    return {
        "items": [
            {
                "entityType": row["entity_type"],
                "entityId": row["entity_id"],
                "message": row["message"],
                "createdAt": row["created_at"],
            }
            for row in rows
        ]
    }


@router.post("/jobs/{job_id}/pause")
def pause_job(job_id: int, request: Request):
    request_pause(db(request), job_id)
    return {"status": "ok"}


@router.post("/jobs/{job_id}/resume")
def resume_job(job_id: int, request: Request):
    request_resume(db(request), job_id)
    return {"status": "ok"}


@router.post("/jobs/{job_id}/cancel")
def cancel_job(job_id: int, request: Request):
    request_cancel(db(request), job_id)
    return {"status": "ok"}


@router.post("/jobs/{job_id}/retry")
def retry_job(job_id: int, request: Request):
    database = db(request)
    database.execute(
        "UPDATE jobs SET status = 'queued', attempts = 0, error = NULL, "
        "finished_at = NULL, cancel_requested = 0, pause_requested = 0 WHERE id = ?",
        (job_id,),
    )
    return {"status": "ok"}


# ------------------------------------------------------------------ images
@router.get("/images")
def list_images(
    request: Request,
    person_id: int | None = None,
    scene: str | None = None,
    source_id: int | None = None,
    year: str | None = None,
    has_faces: bool | None = None,
    unsorted: bool | None = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    database = db(request)
    clauses = [
        "i.thumb_at IS NOT NULL",
        "EXISTS (SELECT 1 FROM files f WHERE f.image_id = i.id AND f.missing_at IS NULL)",
    ]
    params: list[Any] = []
    if person_id is not None:
        clauses.append(
            "EXISTS (SELECT 1 FROM faces f WHERE f.image_id = i.id AND f.person_id = ?)"
        )
        params.append(person_id)
    if scene:
        clauses.append(
            "EXISTS (SELECT 1 FROM scene_labels s WHERE s.image_id = i.id AND s.label = ?)"
        )
        params.append(scene)
    if source_id is not None:
        clauses.append(
            "EXISTS (SELECT 1 FROM files f WHERE f.image_id = i.id AND f.source_id = ?)"
        )
        params.append(source_id)
    if year:
        clauses.append("i.date_taken LIKE ?")
        params.append(f"{year}%")
    if has_faces is not None:
        clauses.append(
            "EXISTS (SELECT 1 FROM faces f WHERE f.image_id = i.id AND f.ignored_at IS NULL)"
            if has_faces
            else "NOT EXISTS (SELECT 1 FROM faces f WHERE f.image_id = i.id AND f.ignored_at IS NULL)"
        )
    if unsorted is not None:
        clauses.append(
            "EXISTS (SELECT 1 FROM faces f WHERE f.image_id = i.id AND f.person_id IS NULL AND f.ignored_at IS NULL)"
            if unsorted
            else "NOT EXISTS (SELECT 1 FROM faces f WHERE f.image_id = i.id AND f.person_id IS NULL AND f.ignored_at IS NULL)"
        )
    where = " WHERE " + " AND ".join(clauses)
    total = int(database.scalar(f"SELECT COUNT(*) FROM images i{where}", tuple(params)) or 0)
    rows = database.query(
        f"SELECT i.* FROM images i{where} ORDER BY i.id DESC LIMIT ? OFFSET ?",
        tuple(params + [limit, offset]),
    )
    return {
        "items": [_image_row(row, database) for row in rows],
        "total": total,
    }


@router.get("/images/{image_id}")
def get_image(image_id: int, request: Request):
    database = db(request)
    row = database.query_one("SELECT * FROM images WHERE id = ?", (image_id,))
    if row is None:
        raise HTTPException(404, "Image not found")
    faces = database.query(
        "SELECT f.*, p.name AS person_name FROM faces f LEFT JOIN people p ON p.id = f.person_id "
        "WHERE f.image_id = ? ORDER BY f.id",
        (image_id,),
    )
    files = database.query(
        "SELECT f.*, s.label AS source_label FROM files f JOIN sources s ON s.id = f.source_id "
        "WHERE f.image_id = ? ORDER BY f.id",
        (image_id,),
    )
    detail = _image_row(row, database)
    detail["faces"] = [
        _face_row(face, include_person=True) for face in faces if not face["ignored_at"]
    ]
    detail["files"] = [
        {
            "sourceId": file["source_id"],
            "sourceLabel": file["source_label"],
            "relPath": file["rel_path"],
            "size": file["size"],
            "missing": file["missing_at"] is not None,
        }
        for file in files
    ]
    detail["phash"] = row["phash"]
    return detail


@router.get("/images/{image_id}/preview")
def image_preview(image_id: int, request: Request, size: int = 1024):
    if size not in (256, 1024):
        raise HTTPException(400, "size must be 256 or 1024")
    database = db(request)
    app_settings = settings(request)
    path = app_settings.thumbs_dir / str(image_id) / f"{size}.webp"

    if not path.exists():
        # Backfill a missing cache entry from the original file. This also makes
        # old libraries work after a cache directory move.
        row = database.query_one(
            "SELECT f.rel_path, s.path AS source_path FROM files f "
            "JOIN sources s ON s.id = f.source_id "
            "WHERE f.image_id = ? AND f.missing_at IS NULL "
            "ORDER BY f.size DESC LIMIT 1",
            (image_id,),
        )
        if row is None:
            raise HTTPException(404, "Preview not ready")
        try:
            asset = load_image_asset(Path(row["source_path"]) / row["rel_path"])
            save_thumbnails(asset.image, image_id, app_settings.thumbs_dir)
            database.execute(
                "UPDATE images SET width = COALESCE(width, ?), height = COALESCE(height, ?), "
                "orientation = COALESCE(orientation, ?), mime_type = COALESCE(mime_type, ?), "
                "date_taken = COALESCE(date_taken, ?), "
                "date_source = CASE WHEN date_taken IS NULL THEN ? ELSE date_source END, "
                "phash = COALESCE(phash, ?), thumb_at = COALESCE(thumb_at, ?), "
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
        except Exception:
            raise HTTPException(404, "Preview not ready")

    if not path.exists():
        raise HTTPException(404, "Preview not ready")
    return FileResponse(path, media_type="image/webp", headers={"Cache-Control": "public, max-age=86400"})


@router.get("/images/{image_id}/file")
def image_file(image_id: int, request: Request):
    database = db(request)
    row = database.query_one(
        "SELECT f.*, s.path AS source_path FROM files f JOIN sources s ON s.id = f.source_id "
        "WHERE f.image_id = ? AND f.missing_at IS NULL ORDER BY f.size DESC LIMIT 1",
        (image_id,),
    )
    if row is None:
        raise HTTPException(404, "Original file not available")
    path = Path(row["source_path"]) / row["rel_path"]
    if not path.exists():
        raise HTTPException(404, "Original file is missing")
    return FileResponse(path, filename=path.name)


@router.get("/faces/{face_id}/thumb")
def face_thumb(face_id: int, request: Request):
    path = settings(request).faces_dir / f"{face_id}.webp"
    if not path.exists():
        raise HTTPException(404, "Face thumbnail not ready")
    return FileResponse(path, media_type="image/webp", headers={"Cache-Control": "public, max-age=86400"})


@router.post("/images/{image_id}/faces")
def add_face(image_id: int, payload: FacePatch, request: Request):
    raise HTTPException(501, "Manual face creation will arrive in the next iteration")


@router.get("/images/{image_id}/similar")
def similar_images(image_id: int, request: Request, k: int = Query(20, ge=1, le=100)):
    database = db(request)
    row = database.query_one(
        "SELECT vector FROM image_embeddings WHERE image_id = ?", (image_id,)
    )
    if row is None:
        raise HTTPException(409, "Embedding not ready")
    import numpy as np

    vector = np.frombuffer(row["vector"], dtype=np.float32)
    rows = database.query(
        "SELECT image_id, vector FROM image_embeddings WHERE image_id != ?", (image_id,)
    )
    scored = []
    for item in rows:
        other = np.frombuffer(item["vector"], dtype=np.float32)
        scored.append((int(item["image_id"]), float(np.dot(vector, other))))
    scored.sort(key=lambda pair: pair[1], reverse=True)
    images = []
    for other_id, score in scored[:k]:
        image = database.query_one("SELECT * FROM images WHERE id = ?", (other_id,))
        if image:
            images.append({"image": _image_row(image, database), "score": score})
    return {"items": images}


@router.get("/search")
def search(
    request: Request,
    q: str = Query(min_length=1),
    person_id: int | None = None,
    scene: str | None = None,
    source_id: int | None = None,
    year: str | None = None,
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
):
    database = db(request)
    try:
        pairs, total = services(request).image_search(
            q,
            person_id=person_id,
            scene=scene,
            source_id=source_id,
            year=year,
            limit=limit,
            offset=offset,
        )
    except ModelNotReady as exc:
        raise HTTPException(409, str(exc))
    items = []
    for image_id, score in pairs:
        row = database.query_one("SELECT * FROM images WHERE id = ?", (image_id,))
        if row is None:
            continue
        summary = _image_row(row, database)
        matches = [f"scene:{summary['primaryScene']}"] if summary["primaryScene"] else []
        matches += [f"person:{person['name']}" for person in summary["people"]]
        items.append({"image": summary, "score": round(score, 4), "matches": matches})
    return {"items": items, "total": total, "tookMs": 0}


@router.get("/scenes")
def scenes(request: Request):
    database = db(request)
    rows = database.query(
        "SELECT label, COUNT(*) AS count FROM scene_labels WHERE is_primary = 1 "
        "GROUP BY label ORDER BY count DESC, label ASC"
    )
    return {
        "items": [
            {
                "label": row["label"],
                "count": int(row["count"]),
                "thumbnailUrl": None,
            }
            for row in rows
        ]
    }


@router.get("/timeline")
def timeline(request: Request):
    database = db(request)
    rows = database.query(
        "SELECT substr(date_taken, 1, 4) AS year, COUNT(*) AS count FROM images "
        "WHERE date_taken IS NOT NULL GROUP BY year ORDER BY year DESC"
    )
    return {"items": [{"year": row["year"], "count": int(row["count"])} for row in rows]}


@router.get("/stats")
def stats(request: Request):
    return services(request).stats()


# ------------------------------------------------------------------ people
@router.get("/people")
def list_people(
    request: Request,
    q: str | None = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    database = db(request)
    where = ""
    params: list[Any] = []
    if q:
        where = " WHERE name LIKE ?"
        params.append(f"%{q}%")
    rows = database.query(
        f"SELECT * FROM people{where} ORDER BY name COLLATE NOCASE LIMIT ? OFFSET ?",
        tuple(params + [limit, offset]),
    )
    total = int(database.scalar(f"SELECT COUNT(*) FROM people{where}", tuple(params)) or 0)
    return {"items": [_person_row(row, database) for row in rows], "total": total}


@router.post("/people", status_code=201)
def create_person(payload: PersonCreate, request: Request):
    database = db(request)
    try:
        name = _validate_name(database, payload.name)
    except ServiceError as exc:
        raise HTTPException(409, str(exc))
    now = now_iso()
    cur = database.execute(
        "INSERT INTO people (name, name_key, created_at, updated_at) VALUES (?, ?, ?, ?)",
        (name, name.casefold(), now, now),
    )
    person_id = int(cur.lastrowid)
    if payload.face_ids:
        _assign_faces(database, person_id, payload.face_ids)
    row = database.query_one("SELECT * FROM people WHERE id = ?", (person_id,))
    return _person_row(row, database)


@router.get("/people/{person_id}")
def get_person(person_id: int, request: Request):
    database = db(request)
    row = database.query_one("SELECT * FROM people WHERE id = ?", (person_id,))
    if row is None:
        raise HTTPException(404, "Person not found")
    detail = _person_row(row, database)
    timeline_rows = database.query(
        "SELECT substr(i.date_taken, 1, 4) AS year, COUNT(DISTINCT i.id) AS count "
        "FROM faces f JOIN images i ON i.id = f.image_id WHERE f.person_id = ? "
        "AND f.ignored_at IS NULL AND i.date_taken IS NOT NULL GROUP BY year ORDER BY year DESC",
        (person_id,),
    )
    detail["timeline"] = [
        {"year": item["year"], "count": int(item["count"])} for item in timeline_rows
    ]
    detail["faces"] = [
        _face_row(face, include_person=True)
        for face in database.query(
            "SELECT f.*, p.name AS person_name FROM faces f LEFT JOIN people p ON p.id = f.person_id "
            "WHERE f.person_id = ? AND f.ignored_at IS NULL ORDER BY f.det_score DESC LIMIT 12",
            (person_id,),
        )
    ]
    return detail


@router.patch("/people/{person_id}")
def patch_person(person_id: int, payload: PersonPatch, request: Request):
    database = db(request)
    row = database.query_one("SELECT * FROM people WHERE id = ?", (person_id,))
    if row is None:
        raise HTTPException(404, "Person not found")
    try:
        name = _validate_name(database, payload.name, exclude_id=person_id)
    except ServiceError as exc:
        raise HTTPException(409, str(exc))
    database.execute(
        "UPDATE people SET name = ?, name_key = ?, updated_at = ? WHERE id = ?",
        (name, name.casefold(), now_iso(), person_id),
    )
    updated = database.query_one("SELECT * FROM people WHERE id = ?", (person_id,))
    return _person_row(updated, database)


@router.delete("/people/{person_id}")
def delete_person(person_id: int, request: Request):
    database = db(request)
    database.execute("UPDATE faces SET person_id = NULL WHERE person_id = ?", (person_id,))
    database.execute("DELETE FROM people WHERE id = ?", (person_id,))
    return {"status": "ok"}


@router.post("/people/merge")
def merge_people(payload: PersonMerge, request: Request):
    database = db(request)
    if payload.source_id == payload.target_id:
        raise HTTPException(400, "Cannot merge a person into themselves")
    source = database.query_one("SELECT * FROM people WHERE id = ?", (payload.source_id,))
    target = database.query_one("SELECT * FROM people WHERE id = ?", (payload.target_id,))
    if source is None or target is None:
        raise HTTPException(404, "Person not found")
    faces = database.query(
        "SELECT id FROM faces WHERE person_id = ?", (payload.source_id,)
    )
    _assign_faces(database, payload.target_id, [int(face["id"]) for face in faces])
    database.execute("DELETE FROM people WHERE id = ?", (payload.source_id,))
    return {"status": "ok", "movedFaces": len(faces)}


@router.post("/people/{person_id}/split")
def split_person(person_id: int, payload: PersonSplit, request: Request):
    database = db(request)
    if database.query_one("SELECT id FROM people WHERE id = ?", (person_id,)) is None:
        raise HTTPException(404, "Person not found")
    try:
        name = _validate_name(database, payload.name)
    except ServiceError as exc:
        raise HTTPException(409, str(exc))
    now = now_iso()
    cur = database.execute(
        "INSERT INTO people (name, name_key, created_at, updated_at) VALUES (?, ?, ?, ?)",
        (name, name.casefold(), now, now),
    )
    new_id = int(cur.lastrowid)
    _assign_faces(database, new_id, payload.face_ids)
    row = database.query_one("SELECT * FROM people WHERE id = ?", (new_id,))
    return _person_row(row, database)


@router.get("/people/{person_id}/faces")
def person_faces(person_id: int, request: Request, limit: int = Query(100, ge=1, le=500)):
    database = db(request)
    rows = database.query(
        "SELECT f.*, p.name AS person_name FROM faces f LEFT JOIN people p ON p.id = f.person_id "
        "WHERE f.person_id = ? AND f.ignored_at IS NULL ORDER BY f.det_score DESC LIMIT ?",
        (person_id, limit),
    )
    return {"items": [_face_row(row, include_person=True) for row in rows]}


def _maybe_enqueue_training(database) -> None:
    threshold = int(database.get_setting("auto_retrain_after", "50") or 50)
    if threshold <= 0:
        return
    last = database.query_one(
        "SELECT trained_at FROM classifier_runs WHERE active = 1 "
        "ORDER BY trained_at DESC LIMIT 1"
    )
    if last is None:
        corrections = int(database.scalar("SELECT COUNT(*) FROM face_corrections") or 0)
    else:
        corrections = int(
            database.scalar(
                "SELECT COUNT(*) FROM face_corrections WHERE created_at > ?",
                (last["trained_at"],),
            )
            or 0
        )
    if corrections < threshold:
        return
    trainable = int(
        database.scalar(
            "SELECT COUNT(*) FROM (SELECT person_id FROM faces "
            "WHERE person_id IS NOT NULL AND ignored_at IS NULL "
            "GROUP BY person_id HAVING COUNT(*) >= 2)"
        )
        or 0
    )
    if trainable >= 2:
        enqueue_job(database, "train_classifier", "ml", priority=30)


def _assign_faces(database, person_id: int, face_ids: list[int]) -> None:
    if not face_ids:
        return
    placeholders = ",".join("?" for _ in face_ids)
    now = now_iso()
    for face_id in face_ids:
        old = database.query_one("SELECT person_id FROM faces WHERE id = ?", (face_id,))
        if old is None:
            continue
        database.execute(
            "UPDATE faces SET person_id = ?, assignment_source = 'manual', "
            "assignment_confidence = 1.0, ignored_at = NULL, updated_at = ? WHERE id = ?",
            (person_id, now, face_id),
        )
        database.execute(
            "INSERT INTO face_corrections (face_id, action, old_person_id, new_person_id, created_at) "
            "VALUES (?, 'label', ?, ?, ?)",
            (face_id, old["person_id"], person_id, now),
        )
    _maybe_enqueue_training(database)


@router.patch("/faces/{face_id}")
def patch_face(face_id: int, payload: FacePatch, request: Request):
    database = db(request)
    row = database.query_one("SELECT * FROM faces WHERE id = ?", (face_id,))
    if row is None:
        raise HTTPException(404, "Face not found")
    now = now_iso()
    correction_id = None
    job_id = None

    if payload.person_id is not None or payload.ignored is not None:
        old_person = row["person_id"]
        new_person = old_person
        if payload.person_id is not None:
            if payload.person_id != 0:
                person = database.query_one(
                    "SELECT id FROM people WHERE id = ?", (payload.person_id,)
                )
                if person is None:
                    raise HTTPException(404, "Person not found")
                new_person = payload.person_id
            else:
                new_person = None
        ignored_at = row["ignored_at"]
        if payload.ignored is not None:
            ignored_at = now if payload.ignored else None
        database.execute(
            "UPDATE faces SET person_id = ?, assignment_source = 'manual', "
            "assignment_confidence = 1.0, ignored_at = ?, updated_at = ? WHERE id = ?",
            (new_person, ignored_at, now, face_id),
        )
        cur = database.execute(
            "INSERT INTO face_corrections (face_id, action, old_person_id, new_person_id, created_at) "
            "VALUES (?, 'label', ?, ?, ?)",
            (face_id, old_person, new_person, now),
        )
        correction_id = int(cur.lastrowid)

    if payload.bbox is not None:
        old_bbox = json.dumps(
            [row["bbox_x1"], row["bbox_y1"], row["bbox_x2"], row["bbox_y2"]]
        )
        database.execute(
            "UPDATE faces SET bbox_x1 = ?, bbox_y1 = ?, bbox_x2 = ?, bbox_y2 = ?, "
            "bbox_source = 'manual', updated_at = ? WHERE id = ?",
            (*payload.bbox, now, face_id),
        )
        cur = database.execute(
            "INSERT INTO face_corrections (face_id, action, old_bbox, new_bbox, created_at) "
            "VALUES (?, 'bbox', ?, ?, ?)",
            (face_id, old_bbox, json.dumps(payload.bbox), now),
        )
        correction_id = int(cur.lastrowid)
        job_id, _ = enqueue_job(
            database,
            "reembed_face",
            "ml",
            payload={"face_id": face_id},
            priority=60,
        )

    _maybe_enqueue_training(database)
    updated = database.query_one(
        "SELECT f.*, p.name AS person_name FROM faces f LEFT JOIN people p ON p.id = f.person_id "
        "WHERE f.id = ?",
        (face_id,),
    )
    return {"face": _face_row(updated), "correctionId": correction_id, "jobId": job_id}


@router.post("/faces/bulk")
def bulk_faces(payload: FaceBulk, request: Request):
    database = db(request)
    if payload.action == "assign":
        if payload.person_id is None:
            raise HTTPException(422, "person_id is required")
        _assign_faces(database, payload.person_id, payload.face_ids)
    elif payload.action == "ignore":
        now = now_iso()
        database.executemany(
            "UPDATE faces SET ignored_at = ?, person_id = NULL, updated_at = ? WHERE id = ?",
            [(now, now, face_id) for face_id in payload.face_ids],
        )
    elif payload.action == "unassign":
        now = now_iso()
        database.executemany(
            "UPDATE faces SET person_id = NULL, assignment_source = 'manual', updated_at = ? WHERE id = ?",
            [(now, face_id) for face_id in payload.face_ids],
        )
    else:
        raise HTTPException(422, "Unknown action")
    _maybe_enqueue_training(database)
    return {"status": "ok", "count": len(payload.face_ids)}


@router.get("/faces/{face_id}/similar")
def similar_faces(face_id: int, request: Request, k: int = Query(12, ge=1, le=50)):
    database = db(request)
    row = database.query_one("SELECT embedding FROM faces WHERE id = ?", (face_id,))
    if row is None:
        raise HTTPException(404, "Face not found")
    import numpy as np

    vector = np.frombuffer(row["embedding"], dtype=np.float32)
    rows = database.query(
        "SELECT f.*, p.name AS person_name FROM faces f LEFT JOIN people p ON p.id = f.person_id "
        "WHERE f.id != ? AND f.ignored_at IS NULL",
        (face_id,),
    )
    scored = []
    for item in rows:
        other = np.frombuffer(item["embedding"], dtype=np.float32)
        scored.append((float(np.dot(vector, other)), item))
    scored.sort(key=lambda pair: pair[0], reverse=True)
    return {
        "items": [
            {"face": _face_row(item, include_person=True), "score": round(score, 4)}
            for score, item in scored[:k]
        ]
    }


@router.post("/corrections/{correction_id}/undo")
def undo_correction(correction_id: int, request: Request):
    database = db(request)
    row = database.query_one(
        "SELECT * FROM face_corrections WHERE id = ?", (correction_id,)
    )
    if row is None:
        raise HTTPException(404, "Correction not found")
    now = now_iso()
    database.execute(
        "UPDATE faces SET person_id = ?, updated_at = ? WHERE id = ?",
        (row["old_person_id"], now, row["face_id"]),
    )
    database.execute(
        "INSERT INTO face_corrections (face_id, action, old_person_id, new_person_id, created_at) "
        "VALUES (?, 'undo', ?, ?, ?)",
        (row["face_id"], row["new_person_id"], row["old_person_id"], now),
    )
    return {"status": "ok"}


# ---------------------------------------------------------------- clusters
@router.get("/clusters")
def list_clusters(request: Request, run_id: int | None = None):
    database = db(request)
    latest = database.query_one("SELECT MAX(id) AS id FROM cluster_runs")
    selected = run_id or (latest["id"] if latest else None)
    if not selected:
        return {"runId": None, "items": []}
    rows = database.query(
        "SELECT c.* FROM clusters c WHERE c.run_id = ? AND c.ignored = 0 "
        "AND c.accepted_person_id IS NULL ORDER BY c.size DESC",
        (selected,),
    )
    items = []
    for row in rows:
        faces = database.query(
            "SELECT f.id, f.image_id FROM faces f WHERE f.cluster_id = ? AND f.ignored_at IS NULL "
            "ORDER BY f.det_score DESC LIMIT 9",
            (row["id"],),
        )
        items.append(
            {
                "id": int(row["id"]),
                "runId": int(row["run_id"]),
                "size": int(row["size"]),
                "sampleFaceIds": [int(face["id"]) for face in faces],
                "sampleFaces": [
                    {"id": int(face["id"]), "imageId": int(face["image_id"])}
                    for face in faces
                ],
                "createdAt": row["created_at"],
            }
        )
    return {"runId": selected, "items": items}


@router.post("/clusters/recluster")
def recluster(request: Request):
    job_id, _ = enqueue_job(db(request), "cluster", "ml", priority=20)
    return {"jobId": job_id}


@router.post("/clusters/{cluster_id}/accept")
def accept_cluster(cluster_id: int, payload: ClusterAccept, request: Request):
    database = db(request)
    row = database.query_one("SELECT * FROM clusters WHERE id = ?", (cluster_id,))
    if row is None:
        raise HTTPException(404, "Cluster not found")
    now = now_iso()
    if payload.merge_into_person_id is not None:
        person = database.query_one(
            "SELECT * FROM people WHERE id = ?", (payload.merge_into_person_id,)
        )
        if person is None:
            raise HTTPException(404, "Person not found")
        person_id = payload.merge_into_person_id
    else:
        try:
            name = _validate_name(database, payload.name)
        except ServiceError as exc:
            raise HTTPException(409, str(exc))
        cur = database.execute(
            "INSERT INTO people (name, name_key, created_at, updated_at) VALUES (?, ?, ?, ?)",
            (name, name.casefold(), now, now),
        )
        person_id = int(cur.lastrowid)

    face_rows = database.query(
        "SELECT id, person_id FROM faces WHERE cluster_id = ? AND ignored_at IS NULL",
        (cluster_id,),
    )
    for face in face_rows:
        database.execute(
            "UPDATE faces SET person_id = ?, assignment_source = 'manual', "
            "assignment_confidence = 1.0, updated_at = ? WHERE id = ?",
            (person_id, now, face["id"]),
        )
        database.execute(
            "INSERT INTO face_corrections (face_id, action, old_person_id, new_person_id, created_at) "
            "VALUES (?, 'cluster_accept', ?, ?, ?)",
            (face["id"], face["person_id"], person_id, now),
        )
    database.execute(
        "UPDATE clusters SET accepted_person_id = ? WHERE id = ?", (person_id, cluster_id)
    )
    _maybe_enqueue_training(database)
    person = database.query_one("SELECT * FROM people WHERE id = ?", (person_id,))
    return {"person": _person_row(person, database), "faces": len(face_rows)}


@router.post("/clusters/{cluster_id}/ignore")
def ignore_cluster(cluster_id: int, request: Request):
    database = db(request)
    database.execute("UPDATE clusters SET ignored = 1 WHERE id = ?", (cluster_id,))
    return {"status": "ok"}


@router.get("/review/faces")
def review_faces(
    request: Request,
    limit: int = Query(120, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    database = db(request)
    where = "f.person_id IS NULL AND f.ignored_at IS NULL"
    total = int(database.scalar(f"SELECT COUNT(*) FROM faces f WHERE {where}") or 0)
    rows = database.query(
        "SELECT f.*, p.name AS person_name FROM faces f "
        "LEFT JOIN people p ON p.id = f.person_id "
        f"WHERE {where} "
        "ORDER BY (f.assignment_confidence IS NULL) DESC, "
        "f.assignment_confidence ASC, f.det_score DESC, f.id ASC "
        "LIMIT ? OFFSET ?",
        (limit, offset),
    )
    return {
        "items": [_face_row(row, include_person=True) for row in rows],
        "total": total,
    }


@router.get("/review")
def review(request: Request):
    database = db(request)
    latest_run = database.scalar("SELECT MAX(id) FROM cluster_runs")
    proposals = 0
    if latest_run:
        proposals = int(
            database.scalar(
                "SELECT COUNT(*) FROM clusters WHERE run_id = ? AND ignored = 0 "
                "AND accepted_person_id IS NULL",
                (latest_run,),
            )
            or 0
        )
    unsorted = int(
        database.scalar(
            "SELECT COUNT(*) FROM faces WHERE person_id IS NULL AND ignored_at IS NULL"
        )
        or 0
    )
    uncertain = int(
        database.scalar(
            "SELECT COUNT(*) FROM faces WHERE person_id IS NULL AND ignored_at IS NULL "
            "AND assignment_confidence IS NOT NULL AND assignment_confidence < 0.5"
        )
        or 0
    )
    classifier = database.query_one(
        "SELECT * FROM classifier_runs WHERE active = 1 ORDER BY trained_at DESC LIMIT 1"
    )
    return {
        "proposedPeople": proposals,
        "unsortedFaces": unsorted,
        "uncertainFaces": uncertain,
        "classifierTrained": classifier is not None,
    }


# --------------------------------------------------------------- classifier
@router.get("/classifier")
def classifier_status(request: Request):
    database = db(request)
    row = database.query_one(
        "SELECT * FROM classifier_runs WHERE active = 1 ORDER BY trained_at DESC LIMIT 1"
    )
    classes = int(database.scalar("SELECT COUNT(*) FROM people") or 0)
    can_train = int(
        database.scalar(
            "SELECT COUNT(*) FROM (SELECT person_id FROM faces WHERE person_id IS NOT NULL "
            "AND ignored_at IS NULL GROUP BY person_id HAVING COUNT(*) >= 2)"
        )
        or 0
    ) >= 2
    if row is None:
        return {
            "trainedAt": None,
            "classes": classes,
            "macroF1": None,
            "threshold": None,
            "embeddingModel": None,
            "stale": False,
            "canTrain": can_train,
            "correctionsSinceTrain": 0,
        }
    corrections = int(
        database.scalar(
            "SELECT COUNT(*) FROM face_corrections WHERE created_at > ?",
            (row["trained_at"],),
        )
        or 0
    )
    metrics = json.loads(row["metrics_json"] or "{}")
    return {
        "trainedAt": row["trained_at"],
        "classes": len(json.loads(row["classes_json"] or "[]")),
        "macroF1": metrics.get("macro_f1"),
        "threshold": row["threshold"],
        "embeddingModel": row["embedding_model"],
        "stale": corrections > 0,
        "canTrain": can_train,
        "correctionsSinceTrain": corrections,
    }


@router.post("/classifier/train")
def train_classifier(request: Request):
    database = db(request)
    job_id, _ = enqueue_job(database, "train_classifier", "ml", priority=30)
    return {"jobId": job_id}


@router.get("/classifier/runs")
def classifier_runs(request: Request):
    database = db(request)
    rows = database.query(
        "SELECT * FROM classifier_runs ORDER BY trained_at DESC LIMIT 20"
    )
    return {
        "items": [
            {
                "id": int(row["id"]),
                "trainedAt": row["trained_at"],
                "macroF1": json.loads(row["metrics_json"] or "{}").get("macro_f1"),
                "classes": len(json.loads(row["classes_json"] or "[]")),
                "active": bool(row["active"]),
            }
            for row in rows
        ]
    }


# ------------------------------------------------------------------ exports
@router.post("/exports/preview")
def export_preview(payload: ExportCreate, request: Request):
    try:
        return services(request).export_preview(payload.destination)
    except ServiceError as exc:
        raise HTTPException(422, str(exc))


@router.post("/exports", status_code=202)
def create_export(payload: ExportCreate, request: Request):
    database = db(request)
    active = database.query_one(
        "SELECT id FROM jobs WHERE type = 'export' AND status IN ('queued','running','paused') LIMIT 1"
    )
    if active is not None:
        raise HTTPException(409, "An export is already running")
    try:
        preview = services(request).export_preview(payload.destination)
    except ServiceError as exc:
        raise HTTPException(422, str(exc))
    now = now_iso()
    cur = database.execute(
        "INSERT INTO exports (destination, config_json, status, total_files, total_bytes, "
        "created_at) VALUES (?, ?, 'queued', ?, ?, ?)",
        (
            preview["destination"],
            json.dumps({"hierarchy": "people>scenes>years>unknown"}),
            preview["copies"],
            preview["bytes"],
            now,
        ),
    )
    export_id = int(cur.lastrowid)
    job_id, _ = enqueue_job(
        database,
        "export",
        "io",
        payload={"export_id": export_id},
        priority=40,
        reuse_active=False,
    )
    return {"exportId": export_id, "jobId": job_id, "preview": preview}


@router.get("/exports")
def list_exports(request: Request):
    database = db(request)
    rows = database.query("SELECT * FROM exports ORDER BY created_at DESC LIMIT 50")
    return {"items": [_export_row(row) for row in rows]}


@router.get("/exports/{export_id}")
def get_export(export_id: int, request: Request):
    database = db(request)
    row = database.query_one("SELECT * FROM exports WHERE id = ?", (export_id,))
    if row is None:
        raise HTTPException(404, "Export not found")
    errors = database.query(
        "SELECT * FROM export_items WHERE export_id = ? AND status = 'error' LIMIT 100",
        (export_id,),
    )
    detail = _export_row(row)
    detail["errors"] = [
        {"path": item["relative_path"], "error": item["error"]} for item in errors
    ]
    return detail


@router.post("/exports/{export_id}/cancel")
def cancel_export(export_id: int, request: Request):
    database = db(request)
    row = database.query_one("SELECT * FROM exports WHERE id = ?", (export_id,))
    if row is None:
        raise HTTPException(404, "Export not found")
    database.execute("UPDATE exports SET status = 'canceled' WHERE id = ?", (export_id,))
    job = database.query_one(
        "SELECT id FROM jobs WHERE type = 'export' AND status IN ('queued','running') "
        "ORDER BY id DESC LIMIT 1"
    )
    if job:
        request_cancel(database, int(job["id"]))
    return {"status": "ok"}


@router.post("/exports/{export_id}/open")
def open_export(export_id: int, request: Request):
    database = db(request)
    row = database.query_one("SELECT destination FROM exports WHERE id = ?", (export_id,))
    if row is None:
        raise HTTPException(404, "Export not found")
    opener = shutil.which("xdg-open")
    if not opener:
        raise HTTPException(501, "xdg-open is not available")
    subprocess.Popen([opener, row["destination"]])
    return {"status": "ok"}


def _export_row(row: Any) -> dict[str, Any]:
    return {
        "id": int(row["id"]),
        "destination": row["destination"],
        "status": row["status"],
        "totalFiles": int(row["total_files"] or 0),
        "totalBytes": int(row["total_bytes"] or 0),
        "copiedFiles": int(row["copied_files"] or 0),
        "copiedBytes": int(row["copied_bytes"] or 0),
        "manifestPath": row["manifest_path"],
        "error": row["error"],
        "createdAt": row["created_at"],
        "startedAt": row["started_at"],
        "finishedAt": row["finished_at"],
    }


# -------------------------------------------------------------------- stream
@router.get("/stream")
async def stream(request: Request):
    database = db(request)

    async def generator():
        last_payload = None
        while True:
            if await request.is_disconnected():
                break
            jobs = await asyncio.to_thread(
                lambda: database.query(
                    "SELECT * FROM jobs WHERE status IN ('queued','running','paused') "
                    "OR created_at > datetime('now', '-1 hour') ORDER BY id DESC LIMIT 50"
                )
            )
            sources = await asyncio.to_thread(
                lambda: database.query("SELECT * FROM sources ORDER BY id")
            )
            payload = {
                "jobs": [
                    {
                        "id": int(job["id"]),
                        "type": job["type"],
                        "status": job["status"],
                        "sourceId": job["source_id"],
                        "current": int(job["progress_current"] or 0),
                        "total": int(job["progress_total"] or 0),
                        "unit": job["progress_unit"],
                        "errorCount": int(job["error_count"] or 0),
                    }
                    for job in jobs
                ],
                "sources": [
                    {"id": int(source["id"]), "status": source["status"]}
                    for source in sources
                ],
            }
            encoded = json.dumps(payload)
            if encoded != last_payload:
                last_payload = encoded
                yield f"event: snapshot\ndata: {encoded}\n\n"
            else:
                yield ": heartbeat\n\n"
            await asyncio.sleep(1.0)

    return StreamingResponse(
        generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
