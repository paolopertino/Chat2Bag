import logging

from collections.abc import MutableMapping
from pathlib import Path

from fastapi import BackgroundTasks

from src.services.component_factory import BackendComponentFactory

logger = logging.getLogger(__name__)


class IndexingService:
    def __init__(self, factory: BackendComponentFactory, status_store: MutableMapping[str, str]):
        self._factory = factory
        self._status_store = status_store

    @staticmethod
    def resolve_and_validate_bag_path(bag_path: str) -> str:
        resolved = Path(bag_path).expanduser().resolve()
        if not resolved.exists() or not resolved.is_dir():
            raise FileNotFoundError("Bag path does not exist.")
        return str(resolved)

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
        except (FileNotFoundError, OSError, RuntimeError, ValueError):
            self._status_store[resolved_bag_path] = "error"
            logger.exception("Indexing failed for %s", resolved_bag_path)

    def queue_index_bag(self, background_tasks: BackgroundTasks, bag_path: str) -> None:
        resolved_bag_path = self.resolve_and_validate_bag_path(bag_path)
        self._status_store[resolved_bag_path] = "indexing"
        background_tasks.add_task(self.index_bag, resolved_bag_path)