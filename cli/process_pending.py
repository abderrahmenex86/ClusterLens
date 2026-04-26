import argparse
import os
import pickle
import shutil
import uuid
from pathlib import Path

import cv2
from insightface.app import FaceAnalysis


def process_pending_folder(
    pending_dir, named_dir, archive_dir, model_path, threshold=0.75
):
    pending_path = Path(pending_dir)
    named_path = Path(named_dir)
    archive_path = Path(archive_dir)

    if not pending_path.exists():
        print(f"Pending folder '{pending_path}' does not exist.")
        return

    archive_path.mkdir(parents=True, exist_ok=True)
    named_path.mkdir(parents=True, exist_ok=True)

    if not Path(model_path).exists():
        print(f"Model file '{model_path}' not found. Run train_svm.py first.")
        return

    with open(model_path, "rb") as f:
        model = pickle.load(f)

    print("Loading InsightFace...")
    app = FaceAnalysis(name="buffalo_l")
    app.prepare(ctx_id=-1, det_size=(640, 640))

    valid_exts = (".jpg", ".jpeg", ".png")
    new_files = [f for f in pending_path.iterdir() if f.suffix.lower() in valid_exts]

    if not new_files:
        print("No new photos in pending folder.")
        return

    print(f"Processing {len(new_files)} new photos...")

    for img_path in new_files:
        img = cv2.imread(str(img_path))
        if img is None:
            continue

        faces = app.get(img)
        if not faces:
            continue
        labels_found = set()

        for face in faces:
            box = face.bbox.astype(int)
            if (
                (box[2] - box[0]) < 128
                or (box[3] - box[1]) < 128
                or face.det_score < 0.7
            ):
                continue

            emb = face.normed_embedding.reshape(1, -1)
            probs = model.predict_proba(emb)[0]
            max_prob = max(probs)

            if max_prob >= threshold:
                best_class_idx = probs.argmax()
                predicted_name = model.classes_[best_class_idx]
            else:
                predicted_name = "Unknown"

            labels_found.add(predicted_name)

        if not labels_found:
            labels_found.add("Unknown")

        for name in labels_found:
            person_dir = named_path / name
            person_dir.mkdir(exist_ok=True)

            dst_link = person_dir / img_path.name
            if not dst_link.exists():
                try:
                    os.link(img_path, dst_link)
                except OSError:
                    shutil.copy2(img_path, dst_link)

        target_archive_path = archive_path / img_path.name
        if target_archive_path.exists():
            unique_id = uuid.uuid4().hex[:6]
            target_archive_path = (
                archive_path / f"{img_path.stem}_{unique_id}{img_path.suffix}"
            )

        shutil.move(str(img_path), str(target_archive_path))
        print(f"Processed: {img_path.name} -> {list(labels_found)}")


if __name__ == "__main__":
    BASE_DIR = Path.home() / "pictures" / "dataset"
    parser = argparse.ArgumentParser()
    parser.add_argument("--pending", default=str(BASE_DIR / "pending"))
    parser.add_argument("--named", default=str(BASE_DIR / "named"))
    parser.add_argument("--archive", default=str(BASE_DIR / "originals"))
    parser.add_argument("--model", default=str(BASE_DIR / "face_svm.pkl"))
    parser.add_argument("--threshold", type=float, default=0.75)
    args = parser.parse_args()

    process_pending_folder(
        args.pending, args.named, args.archive, args.model, args.threshold
    )
