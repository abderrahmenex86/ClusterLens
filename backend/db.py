from __future__ import annotations

import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Iterator, Sequence


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


SCHEMA = """
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT NOT NULL,
    path TEXT NOT NULL UNIQUE,
    recursive INTEGER NOT NULL DEFAULT 1,
    enabled INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'idle',
    last_scan_at TEXT,
    last_error TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content_hash TEXT NOT NULL UNIQUE,
    phash TEXT,
    width INTEGER,
    height INTEGER,
    orientation INTEGER,
    mime_type TEXT,
    date_taken TEXT,
    date_source TEXT NOT NULL DEFAULT 'unknown',
    thumb_at TEXT,
    faces_at TEXT,
    embed_at TEXT,
    scene_at TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    error TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    rel_path TEXT NOT NULL,
    size INTEGER NOT NULL,
    mtime_ns INTEGER NOT NULL,
    content_hash TEXT,
    image_id INTEGER REFERENCES images(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'ok',
    error TEXT,
    missing_at TEXT,
    last_seen_scan_id INTEGER,
    UNIQUE(source_id, rel_path)
);

CREATE TABLE IF NOT EXISTS people (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    name_key TEXT NOT NULL UNIQUE,
    cover_face_id INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cluster_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    embedding_model TEXT NOT NULL,
    params_json TEXT NOT NULL,
    face_count INTEGER NOT NULL DEFAULT 0,
    cluster_count INTEGER NOT NULL DEFAULT 0,
    noise_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'running',
    started_at TEXT NOT NULL,
    finished_at TEXT
);

CREATE TABLE IF NOT EXISTS clusters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER NOT NULL REFERENCES cluster_runs(id) ON DELETE CASCADE,
    label INTEGER NOT NULL,
    size INTEGER NOT NULL DEFAULT 0,
    centroid BLOB,
    accepted_person_id INTEGER REFERENCES people(id) ON DELETE SET NULL,
    ignored INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS faces (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    image_id INTEGER NOT NULL REFERENCES images(id) ON DELETE CASCADE,
    bbox_x1 REAL NOT NULL,
    bbox_y1 REAL NOT NULL,
    bbox_x2 REAL NOT NULL,
    bbox_y2 REAL NOT NULL,
    det_score REAL,
    quality REAL,
    embedding BLOB NOT NULL,
    embedding_model TEXT NOT NULL,
    person_id INTEGER REFERENCES people(id) ON DELETE SET NULL,
    cluster_id INTEGER REFERENCES clusters(id) ON DELETE SET NULL,
    assignment_source TEXT NOT NULL DEFAULT 'none',
    assignment_confidence REAL,
    bbox_source TEXT NOT NULL DEFAULT 'model',
    ignored_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS face_corrections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    face_id INTEGER NOT NULL REFERENCES faces(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    old_person_id INTEGER,
    new_person_id INTEGER,
    old_bbox TEXT,
    new_bbox TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS image_embeddings (
    image_id INTEGER NOT NULL REFERENCES images(id) ON DELETE CASCADE,
    model TEXT NOT NULL,
    vector BLOB NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (image_id, model)
);

CREATE TABLE IF NOT EXISTS scene_labels (
    image_id INTEGER NOT NULL REFERENCES images(id) ON DELETE CASCADE,
    model TEXT NOT NULL,
    label TEXT NOT NULL,
    score REAL NOT NULL,
    is_primary INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    PRIMARY KEY (image_id, model, label)
);

CREATE TABLE IF NOT EXISTS classifier_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    model_path TEXT NOT NULL,
    classes_json TEXT NOT NULL,
    metrics_json TEXT,
    threshold REAL NOT NULL,
    embedding_model TEXT NOT NULL,
    trained_at TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    queue TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    source_id INTEGER REFERENCES sources(id) ON DELETE SET NULL,
    priority INTEGER NOT NULL DEFAULT 0,
    payload_json TEXT,
    progress_current INTEGER NOT NULL DEFAULT 0,
    progress_total INTEGER NOT NULL DEFAULT 0,
    progress_unit TEXT NOT NULL DEFAULT 'items',
    error_count INTEGER NOT NULL DEFAULT 0,
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    cancel_requested INTEGER NOT NULL DEFAULT 0,
    pause_requested INTEGER NOT NULL DEFAULT 0,
    heartbeat_at TEXT,
    created_at TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT,
    error TEXT,
    idempotency_key TEXT UNIQUE
);

CREATE TABLE IF NOT EXISTS job_errors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    entity_type TEXT,
    entity_id INTEGER,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS exports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    destination TEXT NOT NULL,
    config_json TEXT,
    status TEXT NOT NULL DEFAULT 'queued',
    total_files INTEGER NOT NULL DEFAULT 0,
    total_bytes INTEGER NOT NULL DEFAULT 0,
    copied_files INTEGER NOT NULL DEFAULT 0,
    copied_bytes INTEGER NOT NULL DEFAULT 0,
    manifest_path TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT
);

CREATE TABLE IF NOT EXISTS export_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    export_id INTEGER NOT NULL REFERENCES exports(id) ON DELETE CASCADE,
    image_id INTEGER NOT NULL REFERENCES images(id) ON DELETE CASCADE,
    person_id INTEGER,
    relative_path TEXT NOT NULL,
    bytes INTEGER,
    status TEXT NOT NULL DEFAULT 'queued',
    error TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(export_id, relative_path)
);

CREATE INDEX IF NOT EXISTS ix_files_source ON files(source_id);
CREATE INDEX IF NOT EXISTS ix_files_image ON files(image_id);
CREATE INDEX IF NOT EXISTS ix_files_hash ON files(content_hash);
CREATE INDEX IF NOT EXISTS ix_images_jobs ON images(thumb_at, faces_at, embed_at, scene_at);
CREATE INDEX IF NOT EXISTS ix_faces_image ON faces(image_id);
CREATE INDEX IF NOT EXISTS ix_faces_person ON faces(person_id);
CREATE INDEX IF NOT EXISTS ix_faces_cluster ON faces(cluster_id);
CREATE INDEX IF NOT EXISTS ix_scene_labels_label ON scene_labels(label);
CREATE INDEX IF NOT EXISTS ix_jobs_claim ON jobs(status, queue, priority, created_at);
CREATE INDEX IF NOT EXISTS ix_jobs_source ON jobs(source_id);
CREATE INDEX IF NOT EXISTS ix_job_errors_job ON job_errors(job_id);
CREATE INDEX IF NOT EXISTS ix_export_items_export ON export_items(export_id);
"""


DEFAULT_SETTINGS: dict[str, str] = {
    "auto_retrain_after": "50",
    "classifier_threshold": "0.75",
    "cluster_min_size": "4",
    "cluster_min_samples": "3",
    "face_min_det_score": "0.6",
    "face_min_size": "48",
    "knn_high": "0.50",
    "knn_low": "0.35",
    "watcher_enabled": "0",
    "embedding_model": "google/siglip-base-patch16-224",
    "scenes_enabled": "1",
}


class Database:
    def __init__(self, path: Path):
        self.path = path
        self._local = threading.local()

    def connect(self) -> sqlite3.Connection:
        conn = getattr(self._local, "conn", None)
        if conn is not None:
            return conn

        conn = sqlite3.connect(
            str(self.path),
            timeout=30.0,
            check_same_thread=False,
            isolation_level=None,
        )
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode = WAL")
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA busy_timeout = 5000")
        conn.execute("PRAGMA synchronous = NORMAL")
        self._local.conn = conn
        return conn

    def initialize(self) -> None:
        conn = self.connect()
        conn.executescript(SCHEMA)
        for key, value in DEFAULT_SETTINGS.items():
            conn.execute(
                "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)",
                (key, value),
            )

    def query(self, sql: str, params: Sequence[Any] = ()) -> list[sqlite3.Row]:
        return list(self.connect().execute(sql, params).fetchall())

    def query_one(self, sql: str, params: Sequence[Any] = ()) -> sqlite3.Row | None:
        return self.connect().execute(sql, params).fetchone()

    def scalar(self, sql: str, params: Sequence[Any] = ()) -> Any:
        row = self.query_one(sql, params)
        return None if row is None else row[0]

    def execute(self, sql: str, params: Sequence[Any] = ()) -> sqlite3.Cursor:
        conn = self.connect()
        cur = conn.execute(sql, params)
        return cur

    def executemany(self, sql: str, rows: Iterable[Sequence[Any]]) -> None:
        self.connect().executemany(sql, rows)

    @contextmanager
    def transaction(self) -> Iterator[sqlite3.Connection]:
        conn = self.connect()
        conn.execute("BEGIN IMMEDIATE")
        try:
            yield conn
            conn.execute("COMMIT")
        except Exception:
            conn.execute("ROLLBACK")
            raise

    def get_setting(self, key: str, default: str | None = None) -> str | None:
        row = self.query_one("SELECT value FROM settings WHERE key = ?", (key,))
        return default if row is None else str(row["value"])

    def set_setting(self, key: str, value: str) -> None:
        self.execute(
            "INSERT INTO settings (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, value),
        )
