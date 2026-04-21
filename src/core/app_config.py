from dataclasses import dataclass
from functools import lru_cache
from typing import Optional

from src.core.extraction_config import ExtractionConfig
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
    storage_path: Optional[str]


@dataclass(frozen=True)
class ModelsConfig:
    embedding_model: str
    orchestration_llm: str
    video_vlm: str
    model_storage: str


@dataclass(frozen=True)
class SearchConfig:
    temporal_dedup_window_sec: float


@dataclass(frozen=True)
class ApiConfig:
    scan_timeout_sec: float


@dataclass(frozen=True)
class AppConfig:
    ingestion: IngestionConfig
    storage: StorageConfig
    models: ModelsConfig
    search: SearchConfig
    api: ApiConfig
    extraction: ExtractionConfig


def _parse_extraction_config(raw: Optional[dict]) -> ExtractionConfig:
    if not raw or raw.get("service_url") is None:
        return ExtractionConfig.disabled()
    return ExtractionConfig(
        enabled=True,
        service_url=str(raw["service_url"]),
        request_timeout_sec=float(raw.get("request_timeout_sec", 10.0)),
        default_output_subdir=str(raw.get("default_output_subdir", "nuscenes_extractions")),
        editable_fields=tuple(raw.get("editable_fields", [])),
        fixed_overrides=dict(raw.get("fixed_overrides") or {}),
        path_strip_prefix=str(raw["path_strip_prefix"]) if raw.get("path_strip_prefix") else None,
    )


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
            storage_path=str(settings["storage"]["storage_path"]) if settings["storage"]["storage_path"] is not None else None
        ),
        models=ModelsConfig(
            embedding_model=str(settings["models"]["embedding_model"]),
            orchestration_llm=str(settings["models"]["orchestration_llm"]),
            video_vlm=str(settings["models"]["video_vlm"]),
            model_storage=str(settings["models"]["model_storage"]),
        ),
        search=SearchConfig(
            temporal_dedup_window_sec=float(
                settings.get("search", {}).get("temporal_dedup_window_sec", 0.0)
            ),
        ),
        api=ApiConfig(
            scan_timeout_sec=float(
                settings.get("api", {}).get("scan_timeout_sec", 30.0)
            ),
        ),
        extraction=_parse_extraction_config(settings.get("extraction")),
    )
