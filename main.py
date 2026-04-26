import argparse
import json
import logging
import os
import shutil
import sqlite3

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
    cursor = conn.cursor()
    cursor.executescript("""
        CREATE TABLE IF NOT EXISTS images (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filename TEXT UNIQUE
        );

        CREATE TABLE IF NOT EXISTS faces (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            image_id INTEGER,
            bbox TEXT,
            bbox_width INTEGER,
            bbox_height INTEGER,
            det_score REAL,
            embedding BLOB,
            cluster_id INTEGER DEFAULT -1,
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
        image_dir=input_dir, max_distance_threshold=threshold
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
                src = os.path.join(input_dir, dupe_file)
                dst = os.path.join(duplicates_dir, dupe_file)
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

        cursor.execute("SELECT id FROM images WHERE filename = ?", (file,))
        if cursor.fetchone():
            continue

        file_path = os.path.join(input_dir, file)
        img = cv2.imread(file_path)
        if img is None:
            continue

        faces = app.get(img)

        cursor.execute("INSERT INTO images (filename) VALUES (?)", (file,))
        image_id = cursor.lastrowid

        for face in faces:
            box = face.bbox.astype(int)
            bbox_width = int(box[2] - box[0])
            bbox_height = int(box[3] - box[1])
            det_score = float(face.det_score)

            bbox_json = json.dumps(box.tolist())
            embedding_bytes = face.normed_embedding.tobytes()

            cursor.execute(
                """
                INSERT INTO faces (image_id, bbox, bbox_width, bbox_height, det_score, embedding)
                VALUES (?, ?, ?, ?, ?, ?)
            """,
                (
                    image_id,
                    bbox_json,
                    bbox_width,
                    bbox_height,
                    det_score,
                    embedding_bytes,
                ),
            )
            faces_added += 1

        conn.commit()

    logger.info(f"Extraction complete.")
    logger.info(f"Added {faces_added} new faces.")


def cluster_faces(conn, min_cluster_size, min_samples):
    logger.info("Starting HDBSCAN clustering.")
    cursor = conn.cursor()

    cursor.execute("UPDATE faces SET cluster_id = -1")
    conn.commit()

    cursor.execute("""
        SELECT id, embedding FROM faces
        WHERE bbox_width >= 128
        AND bbox_height >= 128
        AND det_score >= 0.7
    """)
    rows = cursor.fetchall()

    if not rows:
        logger.error("No high-quality faces found matching the SQL filters.")
        return

    face_ids = [row[0] for row in rows]
    embeddings = [np.frombuffer(row[1], dtype=np.float32) for row in rows]
    embeddings_matrix = np.array(embeddings)

    clusterer = HDBSCAN(
        min_cluster_size=min_cluster_size,
        min_samples=min_samples,
        metric="euclidean",
        cluster_selection_method="eom",
    )
    labels = clusterer.fit_predict(embeddings_matrix)

    update_data = [(int(label), face_id) for face_id, label in zip(face_ids, labels)]
    cursor.executemany("UPDATE faces SET cluster_id = ? WHERE id = ?", update_data)
    conn.commit()

    unique_people = len(set(labels)) - (1 if -1 in labels else 0)
    noise_faces = list(labels).count(-1)
    logger.info(f"Clustering complete.")
    logger.info(f"{unique_people} unique people found.")
    logger.info(f"{noise_faces} faces assigned to Unknown.")


def export_albums(conn, input_dir, output_dir):
    logger.info("Exporting sorted albums.")
    os.makedirs(output_dir, exist_ok=True)
    cursor = conn.cursor()

    cursor.execute("""
        SELECT faces.cluster_id, images.filename
        FROM faces
        JOIN images ON faces.image_id = images.id
    """)

    rows = cursor.fetchall()
    if not rows:
        logger.warning("No clustered faces found to export.")
        return

    success_count = 0
    for cluster_id, filename in tqdm(rows, desc="Exporting"):
        original_path = os.path.join(input_dir, filename)

        if not os.path.exists(original_path):
            continue

        if cluster_id == -1:
            person_dir = os.path.join(output_dir, "Unknown")
        else:
            person_dir = os.path.join(output_dir, f"Person_{cluster_id}")

        os.makedirs(person_dir, exist_ok=True)
        dest_path = os.path.join(person_dir, filename)

        if os.path.exists(dest_path):
            continue

        try:
            os.link(original_path, dest_path)
            success_count += 1
        except OSError:
            shutil.copy2(original_path, dest_path)
            success_count += 1

    logger.info(f"Successfully organized {success_count} photos into '{output_dir}'.")


def main():
    parser = argparse.ArgumentParser(
        description="Face Clusterer: Extract and organize photos by identity."
    )
    parser.add_argument(
        "--input", required=True, help="Directory containing raw mixed photos."
    )
    parser.add_argument(
        "--duplicates", required=True, help="Directory to move duplicate images."
    )
    parser.add_argument(
        "--output", required=True, help="Directory to output the sorted albums."
    )
    parser.add_argument(
        "--db", default="faces_data.db", help="Path to SQLite database."
    )
    parser.add_argument(
        "--hash-threshold",
        type=int,
        default=2,
        help="Max distance for pHash deduplication.",
    )
    parser.add_argument(
        "--min-cluster", type=int, default=4, help="Minimum photos to form a cluster."
    )
    parser.add_argument(
        "--min-samples",
        type=int,
        default=3,
        help="Strictness of HDBSCAN noise reduction.",
    )

    args = parser.parse_args()

    deduplicate_images(args.input, args.duplicates, args.hash_threshold)

    conn = setup_database(args.db)

    extract_faces(args.input, conn)
    cluster_faces(conn, args.min_cluster, args.min_samples)
    export_albums(conn, args.input, args.output)

    conn.close()
    logger.info("Pipeline finished successfully.")


if __name__ == "__main__":
    main()
