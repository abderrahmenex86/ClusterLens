from __future__ import annotations

import json
import threading
import time
import traceback
from typing import Any, Callable

from .db import Database, now_iso


class JobPaused(Exception):
    pass


class JobCanceled(Exception):
    pass


class JobContext:
    def __init__(self, db: Database, job: dict[str, Any]):
        self.db = db
        self.job = job
        self.job_id = int(job["id"])
        self._last_write = 0.0

    @property
    def payload(self) -> dict[str, Any]:
        raw = self.job.get("payload_json")
        if not raw:
            return {}
        try:
            return json.loads(raw)
        except Exception:
            return {}

    def set_total(self, total: int, unit: str | None = None) -> None:
        self.db.execute(
            "UPDATE jobs SET progress_total = ?, progress_unit = COALESCE(?, progress_unit), "
            "heartbeat_at = ? WHERE id = ?",
            (total, unit, now_iso(), self.job_id),
        )

    def progress(
        self,
        current: int | None = None,
        total: int | None = None,
        message: str | None = None,
        force: bool = False,
    ) -> None:
        now = time.monotonic()
        if not force and now - self._last_write < 0.35:
            return
        self._last_write = now

        fields = ["heartbeat_at = ?"]
        params: list[Any] = [now_iso()]
        if current is not None:
            fields.append("progress_current = ?")
            params.append(current)
        if total is not None:
            fields.append("progress_total = ?")
            params.append(total)
        if message is not None:
            self.job["message"] = message
        params.append(self.job_id)
        self.db.execute(f"UPDATE jobs SET {', '.join(fields)} WHERE id = ?", params)

    def log_error(
        self,
        message: str,
        entity_type: str | None = None,
        entity_id: int | None = None,
    ) -> None:
        self.db.execute(
            "INSERT INTO job_errors (job_id, entity_type, entity_id, message, created_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (self.job_id, entity_type, entity_id, message[:2000], now_iso()),
        )
        self.db.execute(
            "UPDATE jobs SET error_count = error_count + 1 WHERE id = ?",
            (self.job_id,),
        )

    def checkpoint(self) -> None:
        row = self.db.query_one(
            "SELECT cancel_requested, pause_requested FROM jobs WHERE id = ?",
            (self.job_id,),
        )
        if row is None:
            raise JobCanceled()
        if row["cancel_requested"]:
            raise JobCanceled()
        if row["pause_requested"]:
            raise JobPaused()


class Heartbeat(threading.Thread):
    def __init__(self, db: Database, job_id: int):
        super().__init__(daemon=True)
        self.db = db
        self.job_id = job_id
        self.stop_event = threading.Event()

    def run(self) -> None:
        while not self.stop_event.wait(10.0):
            try:
                self.db.execute(
                    "UPDATE jobs SET heartbeat_at = ? WHERE id = ? AND status = 'running'",
                    (now_iso(), self.job_id),
                )
            except Exception:
                return

    def stop(self) -> None:
        self.stop_event.set()


class Worker(threading.Thread):
    def __init__(
        self,
        name: str,
        queue: str,
        db: Database,
        handlers: dict[str, Callable[[JobContext], None]],
    ):
        super().__init__(name=name, daemon=True)
        self.queue = queue
        self.db = db
        self.handlers = handlers
        self.stop_event = threading.Event()

    def stop(self) -> None:
        self.stop_event.set()

    def run(self) -> None:
        while not self.stop_event.is_set():
            job = self.claim()
            if job is None:
                self.stop_event.wait(0.5)
                continue

            job_id = int(job["id"])
            handler = self.handlers.get(str(job["type"]))
            heartbeat = Heartbeat(self.db, job_id)
            heartbeat.start()
            status = "succeeded"
            error: str | None = None

            try:
                if handler is None:
                    raise RuntimeError(f"No handler for job type {job['type']}")
                ctx = JobContext(self.db, dict(job))
                handler(ctx)
                ctx.checkpoint()
            except JobPaused:
                status = "paused"
            except JobCanceled:
                status = "canceled"
            except Exception as exc:
                status = "failed"
                error = f"{type(exc).__name__}: {exc}\n{traceback.format_exc()[-4000:]}"
            finally:
                heartbeat.stop()
                self.finish(job_id, status, error)

    def claim(self) -> dict[str, Any] | None:
        try:
            with self.db.transaction() as conn:
                row = conn.execute(
                    "SELECT * FROM jobs WHERE queue = ? AND status = 'queued' "
                    "ORDER BY priority DESC, created_at ASC, id ASC LIMIT 1",
                    (self.queue,),
                ).fetchone()
                if row is None:
                    return None

                now = now_iso()
                conn.execute(
                    "UPDATE jobs SET status = 'running', started_at = COALESCE(started_at, ?), "
                    "heartbeat_at = ?, attempts = attempts + 1, error = NULL WHERE id = ?",
                    (now, now, row["id"]),
                )
                updated = conn.execute(
                    "SELECT * FROM jobs WHERE id = ?", (row["id"],)
                ).fetchone()
                return dict(updated)
        except Exception:
            return None

    def finish(self, job_id: int, status: str, error: str | None) -> None:
        try:
            self.db.execute(
                "UPDATE jobs SET status = ?, finished_at = ?, error = ?, "
                "heartbeat_at = NULL, pause_requested = 0, cancel_requested = 0 WHERE id = ?",
                (status, now_iso(), error, job_id),
            )
            if status == "failed":
                row = self.db.query_one(
                    "SELECT attempts, max_attempts, type, queue, source_id, payload_json, priority "
                    "FROM jobs WHERE id = ?",
                    (job_id,),
                )
                if row and int(row["attempts"]) < int(row["max_attempts"]):
                    self.db.execute(
                        "UPDATE jobs SET status = 'queued', error = ? WHERE id = ?",
                        (f"Retrying after: {error}", job_id),
                    )
        except Exception:
            pass


def enqueue_job(
    db: Database,
    job_type: str,
    queue: str,
    *,
    source_id: int | None = None,
    payload: dict[str, Any] | None = None,
    priority: int = 0,
    idempotency_key: str | None = None,
    reuse_active: bool = True,
) -> tuple[int, bool]:
    """Returns (job_id, created)."""
    payload_json = json.dumps(payload or {})

    if idempotency_key:
        existing = db.query_one(
            "SELECT id FROM jobs WHERE idempotency_key = ?", (idempotency_key,)
        )
        if existing:
            return int(existing["id"]), False

    if reuse_active:
        existing = db.query_one(
            "SELECT id FROM jobs WHERE type = ? AND "
            "COALESCE(source_id, 0) = COALESCE(?, 0) AND "
            "status IN ('queued', 'running', 'paused') LIMIT 1",
            (job_type, source_id),
        )
        if existing:
            return int(existing["id"]), False

    cur = db.execute(
        "INSERT INTO jobs (type, queue, status, source_id, priority, payload_json, "
        "created_at, idempotency_key) VALUES (?, ?, 'queued', ?, ?, ?, ?, ?)",
        (job_type, queue, source_id, priority, payload_json, now_iso(), idempotency_key),
    )
    return int(cur.lastrowid), True


def request_pause(db: Database, job_id: int) -> None:
    row = db.query_one("SELECT status FROM jobs WHERE id = ?", (job_id,))
    if row is None:
        return
    if row["status"] == "queued":
        db.execute("UPDATE jobs SET status = 'paused' WHERE id = ?", (job_id,))
    elif row["status"] == "running":
        db.execute("UPDATE jobs SET pause_requested = 1 WHERE id = ?", (job_id,))


def request_resume(db: Database, job_id: int) -> None:
    row = db.query_one("SELECT status FROM jobs WHERE id = ?", (job_id,))
    if row is None:
        return
    if row["status"] == "paused":
        db.execute(
            "UPDATE jobs SET status = 'queued', pause_requested = 0 WHERE id = ?",
            (job_id,),
        )


def request_cancel(db: Database, job_id: int) -> None:
    row = db.query_one("SELECT status FROM jobs WHERE id = ?", (job_id,))
    if row is None:
        return
    if row["status"] == "queued":
        db.execute(
            "UPDATE jobs SET status = 'canceled', finished_at = ? WHERE id = ?",
            (now_iso(), job_id),
        )
    elif row["status"] in {"running", "paused"}:
        db.execute(
            "UPDATE jobs SET cancel_requested = 1, status = CASE WHEN status = 'paused' "
            "THEN 'canceled' ELSE status END, finished_at = CASE WHEN status = 'paused' "
            "THEN ? ELSE finished_at END WHERE id = ?",
            (now_iso(), job_id),
        )


def recover_stale_jobs(db: Database, stale_seconds: int = 120) -> None:
    rows = db.query(
        "SELECT id, attempts, max_attempts, finished_at FROM jobs WHERE status = 'running'"
    )
    now = time.time()
    for row in rows:
        heartbeat = db.query_one(
            "SELECT heartbeat_at FROM jobs WHERE id = ?", (row["id"],)
        )
        raw = heartbeat["heartbeat_at"] if heartbeat else None
        if not raw:
            stale = True
        else:
            try:
                from datetime import datetime

                stale = (
                    now - datetime.fromisoformat(raw).timestamp() > stale_seconds
                )
            except Exception:
                stale = True
        if not stale:
            continue
        if int(row["attempts"]) < int(row["max_attempts"]):
            db.execute(
                "UPDATE jobs SET status = 'queued', error = 'Interrupted; requeued', "
                "heartbeat_at = NULL WHERE id = ?",
                (row["id"],),
            )
        else:
            db.execute(
                "UPDATE jobs SET status = 'failed', error = 'Interrupted', "
                "finished_at = ?, heartbeat_at = NULL WHERE id = ?",
                (now_iso(), row["id"]),
            )
