from functools import lru_cache
from typing import Any

import yaml

from src.utils.paths import SETTINGS_PATH


@lru_cache(maxsize=1)
def get_settings() -> dict[str, Any]:
    with SETTINGS_PATH.open("r", encoding="utf-8") as handle:
        loaded = yaml.safe_load(handle)

    if not isinstance(loaded, dict):
        raise ValueError("Settings payload must be a mapping")

    return loaded