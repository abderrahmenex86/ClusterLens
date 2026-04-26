import argparse
import json
import logging
import os
import shutil
import sqlite3
from pathlib import Path

import cv2
import numpy as np
from imagededup.methods import PHash
from insightface.app import FaceAnalysis
from sklearn.cluster import HDBSCAN
from tqdm import tqdm

logging.basicConfig(level=logging.INFO, format="%(asctime)s: %(levelname)s %(message)s")
logger = logging.getLogger(__name__)


def setup_database(path):
    conn = sqlite3.connect(path)
    conn.execute("PRAGMA foreign_keys = ON;")
    cursor = conn.cursor()
    cursor.executescript("""
        CREATE TABLE IF NOT EXISTS images (id INTEGER PRIMARY KEY AUTOINCREMENT, filename TEXT UNIQUE);
        CREATE TABLE IF NOT EXISTS clusters (id INTEGER PRIMARY KEY, name TEXT UNIQUE);
        CREATE TABLE IF NOT EXISTS faces (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            image_id INTEGER, bbox TEXT, bbox_width INTEGER, bbox_height INTEGER,
            det_score REAL, embedding BLOB, cluster_id INTEGER DEFAULT -1,
            FOREIGN KEY(image_id) REFERENCES images(id)
        );
    """)
    conn.commit()
    return conn


def deduplicate_images(input_dir, duplicates_dir, threshold):
    logger.info("Starting Perceptual Hashing deduplication.")
    os.makedirs(duplicates_dir, exist_ok=True)
    phasher = PHash()
    duplicates = phasher.find_duplicates(
        image_dir=str(input_dir), max_distance_threshold=threshold
    )

    moved_files = set()
    sorted_originals = sorted(
        duplicates.keys(),
        key=lambda x: (
            os.path.getsize(os.path.join(input_dir, x))
            if os.path.exists(os.path.join(input_dir, x))
            else 0
        ),
        reverse=True,
    )

    for original in sorted_originals:
        if original in moved_files:
            continue
        for dupe_file in duplicates[original]:
            if dupe_file not in moved_files:
                src, dst = os.path.join(input_dir, dupe_file), os.path.join(
                    duplicates_dir, dupe_file
                )
                if os.path.exists(src):
                    shutil.move(src, dst)
                    moved_files.add(dupe_file)

    logger.info(
        f"Moved {len(moved_files)} lower-quality duplicates to {duplicates_dir}."
    )


def extract_faces(input_dir, conn):
    logger.info("Initializing InsightFace.")
    app = FaceAnalysis(name="buffalo_l")
    app.prepare(ctx_id=-1, det_size=(640, 640))

    valid_exts = (".jpg", ".jpeg", ".png")
    files = sorted([f for f in os.listdir(input_dir) if f.lower().endswith(valid_exts)])

    faces_added = 0
    for file in tqdm(files, desc="Extracting Faces"):
        cursor = conn.cursor()
        if cursor.execute(
            "SELECT id FROM images WHERE filename = ?", (file,)
        ).fetchone():
            continue

        img = cv2.imread(os.path.join(input_dir, file))
        if img is None:
            continue

        faces = app.get(img)
        cursor.execute("INSERT INTO images (filename) VALUES (?)", (file,))
        image_id = cursor.lastrowid

        for face in faces:
            box = face.bbox.astype(int)
            w, h = int(box[2] - box[0]), int(box[3] - box[1])
            cursor.execute(
                "INSERT INTO faces (image_id, bbox, bbox_width, bbox_height, det_score, embedding) VALUES (?, ?, ?, ?, ?, ?)",
                (
                    image_id,
                    json.dumps(box.tolist()),
                    w,
                    h,
                    float(face.det_score),
                    face.normed_embedding.tobytes(),
                ),
            )
            faces_added += 1
        conn.commit()
    logger.info(f"Added {faces_added} new faces.")


def cluster_faces(conn, min_cluster_size, min_samples):
    logger.info("Starting HDBSCAN clustering.")
    cursor = conn.cursor()
    cursor.execute("UPDATE faces SET cluster_id = -1")
    conn.commit()

    rows = cursor.execute(
        "SELECT id, embedding FROM faces WHERE bbox_width >= 128 AND bbox_height >= 128 AND det_score >= 0.7"
    ).fetchall()
    if not rows:
        logger.error("No high-quality faces found matching the SQL filters.")
        return

    face_ids = [row[0] for row in rows]
    embeddings_matrix = np.array(
        [np.frombuffer(row[1], dtype=np.float32) for row in rows]
    )

    clusterer = HDBSCAN(
        min_cluster_size=min_cluster_size,
        min_samples=min_samples,
        metric="euclidean",
        cluster_selection_method="eom",
    )
    labels = clusterer.fit_predict(embeddings_matrix)

    cursor.executemany(
        "UPDATE faces SET cluster_id = ? WHERE id = ?",
        [(int(lbl), fid) for fid, lbl in zip(face_ids, labels)],
    )
    conn.commit()

    logger.info(
        f"{len(set(labels)) - (1 if -1 in labels else 0)} unique people found. {list(labels).count(-1)} faces assigned to Unknown (-1)."
    )


def main():
    BASE_DIR = Path.home() / "pictures" / "dataset"

    parser = argparse.ArgumentParser(description="Batch Face Clusterer")
    parser.add_argument("--input", default=str(BASE_DIR / "originals"))
    parser.add_argument("--duplicates", default=str(BASE_DIR / "duplicates"))
    parser.add_argument("--db", default=str(BASE_DIR / "faces.db"))
    parser.add_argument("--hash-threshold", type=int, default=2)
    parser.add_argument("--min-cluster", type=int, default=4)
    parser.add_argument("--min-samples", type=int, default=3)
    args = parser.parse_args()

    os.makedirs(args.input, exist_ok=True)

    deduplicate_images(args.input, args.duplicates, args.hash_threshold)
    conn = setup_database(args.db)
    extract_faces(args.input, conn)
    cluster_faces(conn, args.min_cluster, args.min_samples)
    conn.close()
    logger.info("Pipeline finished successfully.")


if __name__ == "__main__":
    main()
