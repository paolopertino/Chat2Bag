from pathlib import Path

from data_extraction_lib.embedding import FrameEmbedder
from data_extraction_lib.index import (
    BagIndexBuilder,
    DenseIndexBuilder,
    DenseSearch,
    GlobalSearch,
)

from src.core.app_config import AppConfig
from src.core.index_settings import index_settings_from_config
from src.core.storage import artifacts_for_bag
from src.ingestion.extraction import BagExtractor
from src.services.map_search_service import MapSearchService


class BackendComponentFactory:
    def __init__(self, config: AppConfig, embedder: FrameEmbedder) -> None:
        self._config = config
        self._embedder = embedder
        self._index_settings = index_settings_from_config(config)

    def create_bag_extractor(self, bag_path: str) -> BagExtractor:
        return BagExtractor(bag_path=bag_path, config=self._config)

    def _dense_wanted(self) -> bool:
        return self._config.region_search.enabled and "dense" in self._embedder.capabilities

    def create_bag_index_builder(self, bag_path: str) -> BagIndexBuilder:
        artifacts = artifacts_for_bag(Path(bag_path))
        dense_builder = None
        if self._dense_wanted():
            dense_builder = DenseIndexBuilder(
                region_dir=artifacts.region_dir,
                dim=self._embedder.embedding_dim,
                settings=self._index_settings,
            )
        return BagIndexBuilder(
            self._embedder,
            artifacts,
            batch_size=self._config.ingestion.batch_size,
            dense_builder=dense_builder,
        )

    def create_global_search(self) -> GlobalSearch:
        return GlobalSearch(self._embedder)

    def create_dense_search(self) -> DenseSearch | None:
        if not self._dense_wanted():
            return None
        return DenseSearch(self._embedder, self._index_settings)

    def create_map_search_service(self) -> MapSearchService:
        return MapSearchService(config=self._config)
