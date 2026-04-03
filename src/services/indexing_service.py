import asyncio
import logging

from collections.abc import MutableMapping
from pathlib import Path

from fastapi import BackgroundTasks

from src.retriever.global_search import GlobalSearcher
from src.services.component_factory import BackendComponentFactory

logger = logging.getLogger(__name__)


class IndexingService:
    def __init__(
        self,
        factory: BackendComponentFactory,
        status_store: MutableMapping[str, str],
        searcher: GlobalSearcher | None = None,
    ):
        self._factory = factory
        self._status_store = status_store
        self._searcher = searcher

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
        try:
            parser = self._factory.create_bag_parser(resolved_bag_path)
            parser.extract_frames()
            indexer = self._factory.create_indexer(resolved_bag_path)
            indexer.build_index()
            self._status_store[resolved_bag_path] = "done"
            logger.info("Successfully indexed %s", resolved_bag_path)
            if self._searcher is not None:
                db_path = str(indexer.db_path)
                self._searcher.invalidate_cache(db_path)
                logger.debug("Invalidated LanceDB cache for %s", db_path)
        except (FileNotFoundError, OSError, RuntimeError, ValueError):
            self._status_store[resolved_bag_path] = "error"
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
