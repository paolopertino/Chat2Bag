from dataclasses import dataclass
from functools import lru_cache
from typing import Optional

from src.core.extraction_config import ExtractionConfig
from src.core.settings import get_settings


@dataclass(frozen=True)
class IngestionConfig:
    camera_topics: tuple[str, ...]
    sampling_fps: float
    long_side: int
    batch_size: int
    gps_topic: Optional[str]
    gps_max_gap_sec: float


@dataclass(frozen=True)
class StorageConfig:
    artifact_dir: str
    storage_path: Optional[str]


@dataclass(frozen=True)
class ModelsConfig:
    orchestration_llm: str
    model_storage: str


@dataclass(frozen=True)
class EmbeddingConfig:
    backend: str
    model: str
    encode_long_side: int


@dataclass(frozen=True)
class SearchConfig:
    temporal_dedup_window_sec: float
    map_browse_cap: int


@dataclass(frozen=True)
class ApiConfig:
    scan_timeout_sec: float


@dataclass(frozen=True)
class RegionSearchConfig:
    enabled: bool
    engine: str
    pq_m: int
    pq_nbits: int
    ivf_nlist: Optional[int]
    ivf_nprobe: int
    min_patches_for_pq: int
    train_sample_cap: int
    patch_fetch_limit: int
    top_k_patches: int
    refine_enabled: bool
    refine_top_n: int
    text_templates: tuple[str, ...]


@dataclass(frozen=True)
class AppConfig:
    ingestion: IngestionConfig
    storage: StorageConfig
    models: ModelsConfig
    embedding: EmbeddingConfig
    search: SearchConfig
    api: ApiConfig
    region_search: RegionSearchConfig
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


_DEFAULT_TEMPLATES = (
    "a photo of a {}.",
    "a photo of the {}.",
    "a cropped photo of a {}.",
    "a close-up photo of a {}.",
    "a bright photo of a {}.",
    "a dark photo of a {}.",
    "a blurry photo of a {}.",
    "a low resolution photo of a {}.",
    "a jpeg corrupted photo of a {}.",
    "a photo of a hard to see {}.",
)


def _parse_region_search_config(raw: Optional[dict]) -> RegionSearchConfig:
    raw = raw or {}
    pq = raw.get("pq") or {}
    ivf = raw.get("ivf") or {}
    agg = raw.get("aggregation") or {}
    refine = raw.get("refine") or {}
    templates = raw.get("text_templates")
    return RegionSearchConfig(
        enabled=bool(raw.get("enabled", True)),
        engine=str(raw.get("engine", "faiss")),
        pq_m=int(pq.get("m", 64)),
        pq_nbits=int(pq.get("nbits", 8)),
        ivf_nlist=(int(ivf["nlist"]) if ivf.get("nlist") is not None else None),
        ivf_nprobe=int(ivf.get("nprobe", 16)),
        min_patches_for_pq=int(raw.get("min_patches_for_pq", 10_000)),
        train_sample_cap=int(raw.get("train_sample_cap", 262_144)),
        patch_fetch_limit=int(raw.get("patch_fetch_limit", 4096)),
        top_k_patches=int(agg.get("top_k_patches", 1)),
        refine_enabled=bool(refine.get("enabled", False)),
        refine_top_n=int(refine.get("top_n", 100)),
        text_templates=tuple(templates) if templates else _DEFAULT_TEMPLATES,
    )


@lru_cache(maxsize=1)
def get_app_config() -> AppConfig:
    settings = get_settings()

    return AppConfig(
        ingestion=IngestionConfig(
            camera_topics=tuple(str(t) for t in settings["ingestion"]["camera_topics"]),
            sampling_fps=float(settings["ingestion"]["sampling_fps"]),
            long_side=int(settings["ingestion"]["long_side"]),
            batch_size=int(settings["ingestion"]["batch_size"]),
            gps_topic=(
                str(settings["ingestion"]["gps_topic"])
                if settings["ingestion"].get("gps_topic")
                else None
            ),
            gps_max_gap_sec=float(settings["ingestion"].get("gps_max_gap_sec", 1.0)),
        ),
        storage=StorageConfig(
            artifact_dir=str(settings["storage"]["artifact_dir"]),
            storage_path=str(settings["storage"]["storage_path"]) if settings["storage"]["storage_path"] is not None else None
        ),
        models=ModelsConfig(
            orchestration_llm=str(settings["models"]["orchestration_llm"]),
            model_storage=str(settings["models"]["model_storage"]),
        ),
        embedding=EmbeddingConfig(
            backend=str(settings["embedding"]["backend"]),
            model=str(settings["embedding"]["model"]),
            encode_long_side=int(settings["embedding"].get("encode_long_side", 896)),
        ),
        search=SearchConfig(
            temporal_dedup_window_sec=float(
                settings.get("search", {}).get("temporal_dedup_window_sec", 0.0)
            ),
            map_browse_cap=int(settings.get("search", {}).get("map_browse_cap", 500)),
        ),
        api=ApiConfig(
            scan_timeout_sec=float(
                settings.get("api", {}).get("scan_timeout_sec", 30.0)
            ),
        ),
        region_search=_parse_region_search_config(settings.get("region_search")),
        extraction=_parse_extraction_config(settings.get("extraction")),
    )
