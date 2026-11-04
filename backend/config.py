from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent


def _env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    data_dir: Path
    db_path: Path
    thumbs_dir: Path
    faces_dir: Path
    models_dir: Path
    frontend_dist: Path
    host: str
    port: int
    image_model: str
    image_model_dim: int
    embeddings_enabled: bool
    scenes_enabled: bool
    max_ml_threads: int


def load_settings() -> Settings:
    data_dir = Path(
        os.environ.get("CLUSTERLENS_DATA_DIR", "~/.local/share/clusterlens")
    ).expanduser()
    data_dir.mkdir(parents=True, exist_ok=True)

    thumbs_dir = data_dir / "thumbs"
    faces_dir = data_dir / "face-thumbs"
    models_dir = data_dir / "models"
    for path in (thumbs_dir, faces_dir, models_dir):
        path.mkdir(parents=True, exist_ok=True)

    model = os.environ.get("CLUSTERLENS_IMAGE_MODEL", "google/siglip-base-patch16-224")
    dim = int(os.environ.get("CLUSTERLENS_IMAGE_MODEL_DIM", "768"))

    return Settings(
        data_dir=data_dir,
        db_path=data_dir / "clusterlens.db",
        thumbs_dir=thumbs_dir,
        faces_dir=faces_dir,
        models_dir=models_dir,
        frontend_dist=REPO_ROOT / "frontend" / "dist",
        host=os.environ.get("CLUSTERLENS_HOST", "127.0.0.1"),
        port=int(os.environ.get("CLUSTERLENS_PORT", "8765")),
        image_model=model,
        image_model_dim=dim,
        embeddings_enabled=_env_bool("CLUSTERLENS_EMBEDDINGS", True),
        scenes_enabled=_env_bool("CLUSTERLENS_SCENES", True),
        max_ml_threads=int(os.environ.get("CLUSTERLENS_ML_THREADS", "6")),
    )
