from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from backend.config import Settings
from backend.db import Database, now_iso
from backend.services import Services, ServiceError


class StubContext:
    def __init__(self, job_id: int, payload: dict):
        self.job_id = job_id
        self.payload = payload
        self.messages: list[str] = []

    def progress(self, current=None, total=None, message=None):
        if message:
            self.messages.append(message)

    def log_error(self, message, entity_type=None, entity_id=None):
        self.messages.append(message)

    def checkpoint(self):
        return None


def make_settings(root: Path) -> Settings:
    data = root / "data"
    data.mkdir(parents=True, exist_ok=True)
    thumbs = data / "thumbs"
    faces = data / "faces"
    models = data / "models"
    for path in (thumbs, faces, models):
        path.mkdir(parents=True, exist_ok=True)
    return Settings(
        data_dir=data,
        db_path=data / "test.db",
        thumbs_dir=thumbs,
        faces_dir=faces,
        models_dir=models,
        frontend_dist=root / "dist",
        host="127.0.0.1",
        port=0,
        image_model="test-model",
        image_model_dim=4,
        embeddings_enabled=False,
        scenes_enabled=True,
        max_ml_threads=1,
    )


class ExportRoutingTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.source = self.root / "source"
        self.source.mkdir()
        self.settings = make_settings(self.root)
        self.db = Database(self.settings.db_path)
        self.db.initialize()
        self.db.execute(
            "INSERT INTO sources (label, path, recursive, status, created_at) VALUES (?, ?, 1, 'idle', ?)",
            ("Test", str(self.source), now_iso()),
        )
        self.source_id = 1
        self._add_person(1, "Alice")
        self._add_person(2, "Bob")
        self._add_image(1, "one.jpg", people=[1])
        self._add_image(2, "two.jpg", people=[1, 2])
        self._add_image(3, "three.jpg", faces=1)
        self._add_image(4, "four.jpg", scene="beach")
        self._add_image(5, "five.jpg", date="2020-05-01T10:00:00")
        self._add_image(6, "six.jpg")
        self.services = Services(self.settings, self.db)

    def tearDown(self):
        self.db.close()
        self.tmp.cleanup()

    def _add_person(self, person_id: int, name: str):
        self.db.execute(
            "INSERT INTO people (id, name, name_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
            (person_id, name, name.lower(), now_iso(), now_iso()),
        )

    def _add_image(
        self,
        image_id: int,
        name: str,
        *,
        people: list[int] | None = None,
        faces: int = 0,
        scene: str | None = None,
        date: str | None = None,
    ):
        hash_value = f"hash-{image_id}"
        self.db.execute(
            "INSERT INTO images (id, content_hash, width, height, date_taken, date_source, status, created_at) "
            "VALUES (?, ?, 100, 100, ?, ?, 'done', ?)",
            (image_id, hash_value, date, "exif" if date else "unknown", now_iso()),
        )
        path = self.source / name
        path.write_bytes(b"x" * (100 + image_id))
        self.db.execute(
            "INSERT INTO files (source_id, rel_path, size, mtime_ns, content_hash, image_id, status) "
            "VALUES (?, ?, ?, 0, ?, ?, 'ok')",
            (self.source_id, name, path.stat().st_size, hash_value, image_id),
        )
        person_ids = people or []
        if person_ids:
            for person_id in person_ids:
                self._add_face(image_id, person_id=person_id)
        elif faces:
            for _ in range(faces):
                self._add_face(image_id, person_id=None)
        if scene:
            self.db.execute(
                "INSERT INTO scene_labels (image_id, model, label, score, is_primary, created_at) "
                "VALUES (?, 'test-model', ?, 0.9, 1, ?)",
                (image_id, scene, now_iso()),
            )

    def _add_face(self, image_id: int, person_id: int | None):
        self.db.execute(
            "INSERT INTO faces (image_id, bbox_x1, bbox_y1, bbox_x2, bbox_y2, det_score, quality, "
            "embedding, embedding_model, person_id, created_at, updated_at) "
            "VALUES (?, 0.1, 0.1, 0.5, 0.5, 0.99, 100, ?, 'test', ?, ?, ?)",
            (image_id, b"\x00" * 16, person_id, now_iso(), now_iso()),
        )

    def test_people_first_routing_and_multi_person_copies(self):
        destination = self.root / "export"
        preview = self.services.export_preview(str(destination))
        self.assertEqual(preview["totalPhotos"], 6)
        self.assertEqual(preview["byBranch"]["people"], 3)
        self.assertEqual(preview["byBranch"]["peopleUnsorted"], 1)
        self.assertEqual(preview["byBranch"]["scenes"], 1)
        self.assertEqual(preview["byBranch"]["years"], 1)
        self.assertEqual(preview["byBranch"]["unknown"], 1)
        self.assertEqual(preview["copies"], 7)
        self.assertEqual(preview["multiPersonPhotos"], 1)

    def test_destination_inside_source_is_rejected(self):
        with self.assertRaises(ServiceError):
            self.services.export_preview(str(self.source / "export"))

    def test_nested_source_is_rejected_by_api_validation(self):
        from backend.api import _validate_new_source

        with self.assertRaises(ServiceError):
            _validate_new_source(self.db, self.source / "nested", self.settings.data_dir)


class ScanReadOnlyTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.source = self.root / "source"
        self.source.mkdir()
        self.settings = make_settings(self.root)
        self.db = Database(self.settings.db_path)
        self.db.initialize()
        self.db.execute(
            "INSERT INTO sources (id, label, path, recursive, status, created_at) VALUES (1, 'Phone', ?, 1, 'idle', ?)",
            (str(self.source), now_iso()),
        )
        self.services = Services(self.settings, self.db)

    def tearDown(self):
        self.db.close()
        self.tmp.cleanup()

    def test_scan_does_not_modify_source_files(self):
        from PIL import Image

        image_path = self.source / "photo.png"
        Image.new("RGB", (64, 64), "white").save(image_path)
        before = (image_path.stat().st_mtime_ns, image_path.stat().st_ino)

        ctx = StubContext(1, {"source_id": 1})
        self.services.handle_scan(ctx)

        after = (image_path.stat().st_mtime_ns, image_path.stat().st_ino)
        self.assertEqual(before, after)
        self.assertEqual(int(self.db.scalar("SELECT COUNT(*) FROM files")), 1)
        self.assertEqual(int(self.db.scalar("SELECT COUNT(*) FROM images")), 1)
        self.assertTrue(image_path.exists())


if __name__ == "__main__":
    unittest.main()
