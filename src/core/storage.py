from pathlib import Path

from data_extraction_lib.artifacts import BagArtifacts

from .app_config import get_app_config


def artifacts_for_bag(bag_path: Path) -> BagArtifacts:
    """Resolve a bag's artifact directory (storage policy) and wrap it as BagArtifacts."""
    cfg = get_app_config()
    if cfg.storage.storage_path is not None:
        root = Path(cfg.storage.storage_path) / bag_path.name / cfg.storage.artifact_dir
    else:
        root = bag_path / cfg.storage.artifact_dir
    return BagArtifacts(root)
