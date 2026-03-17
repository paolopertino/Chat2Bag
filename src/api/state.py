import json
import logging

from collections.abc import Iterator, MutableMapping
from pathlib import Path
from threading import Lock
from typing import Any

from src.utils.paths import STATE_PATH

logger = logging.getLogger(__name__)


class PersistentStatusStore(MutableMapping[str, str]):
    def __init__(self, storage_path: Path):
        self._storage_path = storage_path
        self._lock = Lock()
        self._data: dict[str, str] = {}
        self._load()

    def _load(self) -> None:
        if not self._storage_path.exists():
            return

        try:
            with self._storage_path.open("r", encoding="utf-8") as handle:
                payload = json.load(handle)
        except (OSError, json.JSONDecodeError):
            logger.exception(
                "Failed to load persisted indexing state from %s", self._storage_path
            )
            return

        if not isinstance(payload, dict):
            logger.warning(
                "Ignoring invalid indexing state payload in %s", self._storage_path
            )
            return

        self._data = {str(key): str(value) for key, value in payload.items()}

    def _persist(self) -> None:
        self._storage_path.parent.mkdir(parents=True, exist_ok=True)
        temp_path = self._storage_path.with_suffix(f"{self._storage_path.suffix}.tmp")
        with temp_path.open("w", encoding="utf-8") as handle:
            json.dump(self._data, handle, indent=2, sort_keys=True)
        temp_path.replace(self._storage_path)

    def __getitem__(self, key: str) -> str:
        with self._lock:
            return self._data[key]

    def __setitem__(self, key: str, value: str) -> None:
        with self._lock:
            self._data[key] = value
            self._persist()

    def __delitem__(self, key: str) -> None:
        with self._lock:
            del self._data[key]
            self._persist()

    def __iter__(self) -> Iterator[str]:
        with self._lock:
            return iter(self._data.copy())

    def __len__(self) -> int:
        with self._lock:
            return len(self._data)

    def get(self, key: str, default: Any = None) -> Any:
        with self._lock:
            return self._data.get(key, default)


indexing_status = PersistentStatusStore(STATE_PATH)
