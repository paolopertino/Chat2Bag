from pathlib import Path

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
