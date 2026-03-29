from dataclasses import dataclass
from functools import lru_cache

from src.core.settings import get_settings


@dataclass(frozen=True)
class IngestionConfig:
    camera_topic: str
    sampling_fps: float
    max_image_size: tuple[int, int]
    batch_size: int


@dataclass(frozen=True)
class StorageConfig:
    artifact_dir: str


@dataclass(frozen=True)
class ModelsConfig:
    embedding_model: str
    orchestration_llm: str
    video_vlm: str
    model_storage: str


@dataclass(frozen=True)
class AppConfig:
    ingestion: IngestionConfig
    storage: StorageConfig
    models: ModelsConfig


@lru_cache(maxsize=1)
def get_app_config() -> AppConfig:
    settings = get_settings()

    return AppConfig(
        ingestion=IngestionConfig(
            camera_topic=str(settings["ingestion"]["camera_topic"]),
            sampling_fps=float(settings["ingestion"]["sampling_fps"]),
            max_image_size=tuple(settings["ingestion"]["max_image_size"]),
            batch_size=int(settings["ingestion"]["batch_size"]),
        ),
        storage=StorageConfig(
            artifact_dir=str(settings["storage"]["artifact_dir"]),
        ),
        models=ModelsConfig(
            embedding_model=str(settings["models"]["embedding_model"]),
            orchestration_llm=str(settings["models"]["orchestration_llm"]),
            video_vlm=str(settings["models"]["video_vlm"]),
            model_storage=str(settings["models"]["model_storage"]),
        ),
    )