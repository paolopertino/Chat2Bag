from pathlib import Path

from src.core.app_config import AppConfig
from src.core.storage import resolve_artifact_path
from src.embedding import FrameEmbedder
from src.ingestion.bag_parser import BagParser
from src.ingestion.indexer import Indexer
from src.region.dense_indexer import DensePatchIndexer
from src.region.region_search import RegionSearcher
from src.retriever.global_search import GlobalSearcher
from src.retriever.video_chat import VideoChat
from src.services.map_search_service import MapSearchService


class BackendComponentFactory:
    def __init__(self, config: AppConfig, embedder: FrameEmbedder):
        self._config = config
        self._embedder = embedder

    def create_bag_parser(self, bag_path: str) -> BagParser:
        return BagParser(bag_path=bag_path, config=self._config)

    def create_indexer(self, bag_path: str) -> Indexer:
        region_indexer = None
        rc = self._config.region_search
        if rc.enabled and "dense" in self._embedder.capabilities:
            region_dir = resolve_artifact_path(bag_path=Path(bag_path)) / "region"
            region_indexer = DensePatchIndexer(
                region_dir=region_dir,
                dim=self._embedder.embedding_dim,
                region_config=rc,
            )
        return Indexer(
            bag_path=bag_path,
            config=self._config,
            embedder=self._embedder,
            region_indexer=region_indexer,
        )

    def create_global_searcher(self) -> GlobalSearcher:
        return GlobalSearcher(config=self._config, embedder=self._embedder)

    def create_region_searcher(self) -> RegionSearcher | None:
        rc = self._config.region_search
        if not (rc.enabled and "dense" in self._embedder.capabilities):
            return None
        return RegionSearcher(config=self._config, embedder=self._embedder)

    def create_video_chat(self, bag_path: str) -> VideoChat:
        return VideoChat(bag_path=bag_path, config=self._config)

    def create_map_search_service(self) -> MapSearchService:
        return MapSearchService(config=self._config)
