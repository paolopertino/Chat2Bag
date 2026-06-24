from pathlib import Path

from data_extraction_lib.artifacts import BagArtifacts

from .app_config import get_app_config


def resolve_artifact_path(bag_path: Path) -> Path:
    """
    Resolves the storage path for artifacts based on the configuration and bag file location.

    :param bag_path: The path to the bag file being processed.
    :type bag_path: Path
    :return: The resolved storage path for artifacts.
    :rtype: Path
    """
    app_cfg = get_app_config()

    return (
        Path(app_cfg.storage.storage_path)
        / bag_path.name
        / app_cfg.storage.artifact_dir
        if app_cfg.storage.storage_path is not None
        else bag_path / app_cfg.storage.artifact_dir
    )


def metadata_path_for_bag(bag: Path) -> Path:
    """Return the path to the metadata.json artifact for a bag directory."""
    return resolve_artifact_path(bag_path=bag) / "metadata.json"


def artifacts_for_bag(bag_path: Path) -> BagArtifacts:
    """Resolve a bag's artifact directory (storage policy) and wrap it as BagArtifacts."""
    cfg = get_app_config()
    if cfg.storage.storage_path is not None:
        root = Path(cfg.storage.storage_path) / bag_path.name / cfg.storage.artifact_dir
    else:
        root = bag_path / cfg.storage.artifact_dir
    return BagArtifacts(root)
