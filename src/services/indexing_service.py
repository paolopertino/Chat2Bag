import asyncio
import logging

from collections.abc import MutableMapping
from pathlib import Path

from fastapi import BackgroundTasks

from data_extraction_lib.artifacts import IndexManifest
from data_extraction_lib.index import DenseSearch, GlobalSearch
from src.core.storage import artifacts_for_bag
from src.services.component_factory import BackendComponentFactory

logger = logging.getLogger(__name__)


class IndexingService:
    def __init__(
        self,
        factory: BackendComponentFactory,
        status_store: MutableMapping[str, str],
        global_search: GlobalSearch | None = None,
        dense_search: DenseSearch | None = None,
        error_store: MutableMapping[str, str] | None = None,
    ):
        self._factory = factory
        self._status_store = status_store
        self._global_search = global_search
        self._dense_search = dense_search
        self._error_store = error_store if error_store is not None else {}

    @staticmethod
    def resolve_and_validate_bag_path(bag_path: str) -> str:
        resolved = Path(bag_path).expanduser().resolve()
        if not resolved.exists() or not resolved.is_dir():
            raise FileNotFoundError("Bag path does not exist.")
        return str(resolved)

    def reset_status(self, bag_path: str) -> None:
        """Reset a bag's indexing status to 'idle', clearing any stuck state."""
        resolved = str(Path(bag_path).expanduser().resolve())
        self._status_store[resolved] = "idle"

    def index_bag(self, bag_path: str) -> None:
        """Run extraction and indexing for a validated absolute bag path."""
        resolved_bag_path = str(Path(bag_path).expanduser().resolve())
        self._status_store[resolved_bag_path] = "indexing"
        self._error_store.pop(resolved_bag_path, None)
        # Clear any stale completion marker before extraction so a failure here
        # (before build_index runs) cannot leave the bag reading as indexed.
        IndexManifest.delete(artifacts_for_bag(Path(resolved_bag_path)))
        try:
            extractor = self._factory.create_bag_extractor(resolved_bag_path)
            extractor.extract()
            self._factory.create_bag_index_builder(resolved_bag_path).build()
            self._status_store[resolved_bag_path] = "done"
            self._error_store.pop(resolved_bag_path, None)
            logger.info("Successfully indexed %s", resolved_bag_path)
            artifacts = artifacts_for_bag(Path(resolved_bag_path))
            if self._global_search is not None:
                self._global_search.invalidate(artifacts)
                logger.debug("Invalidated global search cache for %s", resolved_bag_path)
            if self._dense_search is not None:
                self._dense_search.invalidate(artifacts)
                logger.debug("Invalidated dense search cache for %s", resolved_bag_path)
        except Exception as exc:  # noqa: BLE001 - any failure marks the bag as errored
            self._status_store[resolved_bag_path] = "error"
            self._error_store[resolved_bag_path] = str(exc)
            logger.exception("Indexing failed for %s", resolved_bag_path)

    async def queue_index_bag(
        self, background_tasks: BackgroundTasks, bag_path: str
    ) -> None:
        resolved_bag_path = self.resolve_and_validate_bag_path(bag_path)

        current_status = self._status_store.get(resolved_bag_path)
        if current_status == "indexing":
            raise ValueError(f"Bag is already being indexed: {resolved_bag_path}")

        loop = asyncio.get_event_loop()
        await loop.run_in_executor(
            None, lambda: self._status_store.__setitem__(resolved_bag_path, "indexing")
        )
        background_tasks.add_task(self.index_bag, resolved_bag_path)
