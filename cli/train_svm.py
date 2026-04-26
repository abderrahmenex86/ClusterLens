import argparse
import pickle
import sqlite3
from pathlib import Path

import numpy as np
from sklearn.metrics import classification_report
from sklearn.model_selection import train_test_split
from sklearn.svm import SVC


def train_svm(db_path, output_model_path):
    print("Loading data from database...")
    conn = sqlite3.connect(db_path)

    query = """
        SELECT f.embedding, 
               COALESCE(c.name, 'Person_' || f.cluster_id) as label
        FROM faces f
        LEFT JOIN clusters c ON f.cluster_id = c.id
        WHERE f.cluster_id != -1
    """
    rows = conn.execute(query).fetchall()
    conn.close()

    if not rows:
        print("No labeled data found to train on.")
        return

    X = np.array([np.frombuffer(row[0], dtype=np.float32) for row in rows])
    y = np.array([row[1] for row in rows])

    print(f"Loaded {len(X)} faces across {len(set(y))} identities.")

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.15, random_state=1337
    )

    print("Training Linear SVM...")
    model = SVC(kernel="linear", probability=True, class_weight="balanced", C=1.0)
    model.fit(X_train, y_train)

    print("\n--- Model Evaluation ---")
    y_pred = model.predict(X_test)
    print(classification_report(y_test, y_pred, zero_division=0))

    with open(output_model_path, "wb") as f:
        pickle.dump(model, f)
    print(f"Model saved to {output_model_path}")


if __name__ == "__main__":
    BASE_DIR = Path.home() / "pictures" / "dataset"
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default=str(BASE_DIR / "faces.db"))
    parser.add_argument("--model-out", default=str(BASE_DIR / "face_svm.pkl"))
    args = parser.parse_args()

    train_svm(args.db, args.model_out)
