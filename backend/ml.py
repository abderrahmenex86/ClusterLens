from __future__ import annotations

import hashlib
import io
import mimetypes
import os
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image, ImageOps

try:
    import pillow_heif

    pillow_heif.register_heif_opener()
except Exception:
    pass

import imagehash

from .config import Settings

# Public model weights should work without a Hugging Face login. An expired
# cached token otherwise turns a public download into a 401.
os.environ.setdefault("HF_HUB_DISABLE_IMPLICIT_TOKEN", "1")
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")


SUPPORTED_EXTENSIONS = {
    ".jpg",
    ".jpeg",
    ".png",
    ".webp",
    ".heic",
    ".heif",
    ".bmp",
    ".tif",
    ".tiff",
}

SCENE_PROMPTS: dict[str, str] = {
    "beach": "a photo of a beach",
    "mountain": "a photo of mountains",
    "forest": "a photo of a forest",
    "city": "a photo of a city",
    "street": "a photo of a street",
    "home": "a photo inside a home",
    "restaurant": "a photo inside a restaurant",
    "cafe": "a photo inside a cafe",
    "food": "a photo of food",
    "drink": "a photo of a drink",
    "pet": "a photo of a pet",
    "dog": "a photo of a dog",
    "cat": "a photo of a cat",
    "car": "a photo of a car",
    "document": "a photo of a document",
    "screenshot": "a screenshot",
    "receipt": "a photo of a receipt",
    "whiteboard": "a photo of a whiteboard",
    "paper": "a photo of a paper document",
    "book": "a photo of a book page",
    "form": "a photo of a form",
    "concert": "a photo of a concert",
    "wedding": "a photo of a wedding",
    "party": "a photo of a party",
    "snow": "a photo of snow",
    "sunset": "a photo of a sunset",
    "night": "a photo at night",
    "water": "a photo of water",
    "lake": "a photo of a lake",
    "river": "a photo of a river",
    "garden": "a photo of a garden",
    "park": "a photo of a park",
    "museum": "a photo inside a museum",
    "church": "a photo of a church",
    "airport": "a photo inside an airport",
    "train": "a photo of a train",
    "boat": "a photo of a boat",
    "flowers": "a photo of flowers",
    "sky": "a photo of the sky",
    "building": "a photo of a building",
    "room": "a photo of a room",
    "kitchen": "a photo of a kitchen",
    "office": "a photo of an office",
    "school": "a photo of a school",
    "sports": "a photo of sports",
    "crowd": "a photo of a crowd",
    "selfie": "a selfie",
    "portrait": "a portrait photo",
    "landscape": "a landscape photo",
}


@dataclass
class FaceResult:
    bbox: tuple[float, float, float, float]
    det_score: float
    quality: float
    embedding: np.ndarray


@dataclass
class ImageAsset:
    image: Image.Image
    width: int
    height: int
    orientation: int
    date_taken: str | None
    date_source: str
    phash: str
    mime_type: str


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _parse_exif_date(value: Any) -> str | None:
    if not value:
        return None
    if isinstance(value, bytes):
        value = value.decode("utf-8", "ignore")
    text = str(value).strip()
    for fmt in ("%Y:%m:%d %H:%M:%S", "%Y-%m-%d %H:%M:%S"):
        try:
            from datetime import datetime

            return datetime.strptime(text, fmt).isoformat(timespec="seconds")
        except ValueError:
            continue
    return None


def load_image_asset(path: Path) -> ImageAsset:
    with Image.open(path) as raw:
        exif = raw.getexif()
        orientation = int(exif.get(274, 1) or 1)
        date_taken = _parse_exif_date(
            exif.get(36867) or exif.get(36868) or exif.get(306)
        )
        image = ImageOps.exif_transpose(raw)
        image = image.convert("RGB")

    width, height = image.size
    mime_type = mimetypes.guess_type(path.name)[0] or "image/jpeg"
    return ImageAsset(
        image=image,
        width=width,
        height=height,
        orientation=orientation,
        date_taken=date_taken,
        date_source="exif" if date_taken else "unknown",
        phash=str(imagehash.phash(image)),
        mime_type=mime_type,
    )


def save_thumbnails(image: Image.Image, image_id: int, thumbs_dir: Path) -> str:
    base = thumbs_dir / str(image_id)
    base.mkdir(parents=True, exist_ok=True)
    for size in (256, 1024):
        thumb = image.copy()
        thumb.thumbnail((size, size), Image.Resampling.LANCZOS)
        thumb.save(base / f"{size}.webp", "WEBP", quality=82, method=4)
    return str(base / "1024.webp")


def save_face_crop(
    image: Image.Image,
    bbox: tuple[float, float, float, float],
    face_id: int,
    faces_dir: Path,
) -> None:
    width, height = image.size
    x1, y1, x2, y2 = bbox
    pad = 0.18 * max(x2 - x1, y2 - y1)
    left = max(0, int((x1 - pad) * width))
    top = max(0, int((y1 - pad) * height))
    right = min(width, int((x2 + pad) * width))
    bottom = min(height, int((y2 + pad) * height))
    if right <= left or bottom <= top:
        return
    crop = image.crop((left, top, right, bottom))
    crop.thumbnail((256, 256), Image.Resampling.LANCZOS)
    crop.save(faces_dir / f"{face_id}.webp", "WEBP", quality=85, method=4)


def _normalize(vector: np.ndarray) -> np.ndarray:
    vector = np.asarray(vector, dtype=np.float32).reshape(-1)
    norm = float(np.linalg.norm(vector))
    if norm <= 1e-9:
        return vector
    return vector / norm


class FaceAnalyzer:
    def __init__(self) -> None:
        self._app = None
        self._lock = threading.Lock()

    def _load(self):
        if self._app is None:
            from insightface.app import FaceAnalysis

            app = FaceAnalysis(name="buffalo_l", providers=["CPUExecutionProvider"])
            app.prepare(ctx_id=-1, det_size=(640, 640))
            self._app = app
        return self._app

    def analyze(self, image: Image.Image, min_size: int) -> list[FaceResult]:
        import cv2

        rgb = np.asarray(image)
        bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
        height, width = bgr.shape[:2]

        with self._lock:
            app = self._load()
            detected = app.get(bgr)

        results: list[FaceResult] = []
        for face in detected:
            x1, y1, x2, y2 = face.bbox.astype(float).tolist()
            face_width = max(0.0, x2 - x1)
            face_height = max(0.0, y2 - y1)
            if face_width < min_size or face_height < min_size:
                continue
            embedding = _normalize(face.normed_embedding)
            results.append(
                FaceResult(
                    bbox=(
                        max(0.0, min(1.0, x1 / width)),
                        max(0.0, min(1.0, y1 / height)),
                        max(0.0, min(1.0, x2 / width)),
                        max(0.0, min(1.0, y2 / height)),
                    ),
                    det_score=float(face.det_score),
                    quality=float(min(face_width, face_height)),
                    embedding=embedding,
                )
            )
        return results


class ImageEmbedder:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.model_name = settings.image_model
        self._model = None
        self._processor = None
        self._prompt_vectors: np.ndarray | None = None
        self._prompt_labels: list[str] = []
        self._lock = threading.Lock()

    def _load(self):
        if self._model is not None:
            return
        import torch
        from transformers import AutoModel, AutoProcessor

        torch.set_num_threads(self.settings.max_ml_threads)
        self._processor = AutoProcessor.from_pretrained(self.model_name)
        self._model = AutoModel.from_pretrained(self.model_name)
        self._model.eval()

    def available(self) -> bool:
        try:
            self._load()
            return True
        except Exception:
            return False

    @staticmethod
    def _pooled(output: Any):
        import torch

        if isinstance(output, torch.Tensor):
            return output
        if hasattr(output, "pooler_output"):
            return output.pooler_output
        if isinstance(output, tuple):
            return output[0]
        return output

    def embed_images(self, images: list[Image.Image]) -> np.ndarray:
        import torch

        self._load()
        assert self._processor is not None and self._model is not None
        inputs = self._processor(images=images, return_tensors="pt")
        with self._lock, torch.inference_mode():
            features = self._pooled(self._model.get_image_features(**inputs))
        features = torch.nn.functional.normalize(features, dim=-1)
        return features.cpu().numpy().astype(np.float32)

    def embed_texts(self, texts: list[str]) -> np.ndarray:
        import torch

        self._load()
        assert self._processor is not None and self._model is not None
        inputs = self._processor(
            text=texts,
            padding="max_length",
            truncation=True,
            return_tensors="pt",
        )
        with self._lock, torch.inference_mode():
            features = self._pooled(self._model.get_text_features(**inputs))
        features = torch.nn.functional.normalize(features, dim=-1)
        return features.cpu().numpy().astype(np.float32)

    def label_image(self, vector: np.ndarray, top_k: int = 5) -> list[tuple[str, float]]:
        if self._prompt_vectors is None:
            labels = list(SCENE_PROMPTS.keys())
            vectors = self.embed_texts([SCENE_PROMPTS[label] for label in labels])
            self._prompt_labels = labels
            self._prompt_vectors = vectors

        assert self._prompt_vectors is not None
        scores = self._prompt_vectors @ vector.reshape(-1)
        order = np.argsort(-scores)[:top_k]
        results: list[tuple[str, float]] = []
        for index in order:
            score = float(scores[index])
            # SigLIP cosine scores live on a narrower band than CLIP; these
            # thresholds are intentionally model-specific.
            if score < 0.02:
                continue
            results.append((self._prompt_labels[int(index)], score))
        return results


class MLRegistry:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.faces = FaceAnalyzer()
        self.images = ImageEmbedder(settings)


def start_models(settings: Settings) -> MLRegistry:
    return MLRegistry(settings)
