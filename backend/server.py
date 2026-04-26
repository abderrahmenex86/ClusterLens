import argparse
import io
import json
import os
import shutil
import sqlite3
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from PIL import Image
from pydantic import BaseModel, Field

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_db(request: Request):
    db_path = request.app.state.db_path
    conn = sqlite3.connect(db_path, timeout=10.0, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    try:
        yield conn
    finally:
        conn.close()


def get_input_dir(request: Request) -> Path:
    return Path(request.app.state.input_dir)


class RenamePayload(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class MergePayload(BaseModel):
    src_id: int
    dst_id: int


class ExportPayload(BaseModel):
    output_dir: str = Field(min_length=1)


@app.get("/api/clusters")
def list_clusters(
    limit: int = Query(100, ge=1),
    offset: int = Query(0, ge=0),
    conn: sqlite3.Connection = Depends(get_db),
):
    rows = conn.execute(
        """
        SELECT f.cluster_id, c.name, COUNT(*) as face_count
        FROM faces f
        LEFT JOIN clusters c ON f.cluster_id = c.id
        GROUP BY f.cluster_id, c.name
        ORDER BY face_count DESC
        LIMIT ? OFFSET ?
    """,
        (limit, offset),
    ).fetchall()

    clusters = []
    for r in rows:
        c_id = r["cluster_id"]
        if r["name"]:
            display_name = r["name"]
        elif c_id == -1:
            display_name = "Unknown"
        else:
            display_name = f"Person_{c_id}"

        clusters.append(
            {"cluster_id": c_id, "name": display_name, "face_count": r["face_count"]}
        )

    return {"clusters": clusters}


@app.get("/api/clusters/{cluster_id}/faces")
def list_faces(
    cluster_id: int,
    limit: int = Query(60, ge=1),
    offset: int = Query(0, ge=0),
    conn: sqlite3.Connection = Depends(get_db),
):
    rows = conn.execute(
        """
        SELECT f.id, i.filename, f.bbox
        FROM faces f JOIN images i ON f.image_id = i.id
        WHERE f.cluster_id = ?
        LIMIT ? OFFSET ?
    """,
        (cluster_id, limit, offset),
    ).fetchall()

    return {
        "faces": [
            {
                "face_id": r["id"],
                "filename": r["filename"],
                "bbox": json.loads(r["bbox"]),
            }
            for r in rows
        ]
    }


@app.get("/api/faces/{face_id}/crop")
def get_face_crop(
    face_id: int,
    size: int = Query(220, ge=64, le=512),
    conn: sqlite3.Connection = Depends(get_db),
    input_dir: Path = Depends(get_input_dir),
):
    row = conn.execute(
        "SELECT i.filename, f.bbox FROM faces f JOIN images i ON i.id = f.image_id WHERE f.id = ?",
        (face_id,),
    ).fetchone()
    if not row:
        raise HTTPException(404, "Face not found")

    img_path = input_dir / row["filename"]
    try:
        img = Image.open(img_path).convert("RGB")
        box = json.loads(row["bbox"])
        crop = img.crop(
            (
                max(0, int(box[0])),
                max(0, int(box[1])),
                min(img.width, int(box[2])),
                min(img.height, int(box[3])),
            )
        )
        crop.thumbnail((size, size), Image.Resampling.LANCZOS)

        canvas = Image.new("RGB", (size, size), color=(0, 0, 0))
        canvas.paste(crop, ((size - crop.width) // 2, (size - crop.height) // 2))

        buf = io.BytesIO()
        canvas.save(buf, format="JPEG", quality=85)
        buf.seek(0)
        return StreamingResponse(
            buf,
            media_type="image/jpeg",
            headers={"Cache-Control": "public, max-age=86400"},
        )
    except Exception as e:
        raise HTTPException(500, f"Crop failed: {str(e)}")


@app.put("/api/clusters/{cluster_id}/name")
def rename_cluster(
    cluster_id: int, payload: RenamePayload, conn: sqlite3.Connection = Depends(get_db)
):
    if cluster_id == -1:
        raise HTTPException(400, "Cannot rename Unknown (-1)")
    conn.execute(
        "INSERT OR REPLACE INTO clusters (id, name) VALUES (?, ?)",
        (cluster_id, payload.name.strip()),
    )
    conn.commit()
    return {"status": "success", "cluster_id": cluster_id, "name": payload.name.strip()}


@app.post("/api/clusters/merge")
def merge_clusters(payload: MergePayload, conn: sqlite3.Connection = Depends(get_db)):
    if payload.src_id == payload.dst_id:
        raise HTTPException(400, "Cannot merge into itself")
    if payload.src_id == -1 or payload.dst_id == -1:
        raise HTTPException(400, "Cannot merge the Unknown (-1) cluster directly")

    cursor = conn.execute(
        "UPDATE faces SET cluster_id = ? WHERE cluster_id = ?",
        (payload.dst_id, payload.src_id),
    )
    conn.execute("DELETE FROM clusters WHERE id = ?", (payload.src_id,))
    conn.commit()
    return {"status": "success", "moved_faces": cursor.rowcount}


@app.post("/api/export")
def export_named_albums(
    payload: ExportPayload,
    conn: sqlite3.Connection = Depends(get_db),
    input_dir: Path = Depends(get_input_dir),
):
    out_dir = Path(payload.output_dir).resolve()
    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    rows = conn.execute("""
        SELECT f.cluster_id, i.filename, c.name
        FROM faces f
        JOIN images i ON i.id = f.image_id
        LEFT JOIN clusters c ON c.id = f.cluster_id
    """).fetchall()

    success = 0
    for r in rows:
        folder = (
            "Unknown"
            if r["cluster_id"] == -1
            else (r["name"] if r["name"] else f"Unlabeled_Person_{r['cluster_id']}")
        )
        target_dir = out_dir / folder
        target_dir.mkdir(exist_ok=True)

        src, dst = input_dir / r["filename"], target_dir / Path(r["filename"]).name
        if src.exists() and not dst.exists():
            try:
                os.link(src, dst)
            except OSError:
                shutil.copy2(src, dst)
            success += 1

    return {"status": "success", "exported": success}


if __name__ == "__main__":
    import uvicorn

    BASE_DIR = Path.home() / "pictures" / "dataset"

    parser = argparse.ArgumentParser()
    parser.add_argument("--db-file", default=str(BASE_DIR / "faces.db"))
    parser.add_argument("--input-dir", default=str(BASE_DIR / "originals"))
    parser.add_argument("--port", default=8000, type=int)
    args = parser.parse_args()

    app.state.db_path = str(Path(args.db_file).resolve())
    app.state.input_dir = str(Path(args.input_dir).resolve())

    uvicorn.run(app, host="127.0.0.1", port=args.port)
