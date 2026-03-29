from src.core.app_config import AppConfig
from src.ingestion.bag_parser import BagParser
from src.ingestion.indexer import Indexer
from src.retriever.global_search import GlobalSearcher
from src.retriever.video_chat import VideoChat


class BackendComponentFactory:
    def __init__(self, config: AppConfig, embedding_model=None, embedding_processor=None):
        self._config = config
        self._embedding_model = embedding_model
        self._embedding_processor = embedding_processor

    def create_bag_parser(self, bag_path: str) -> BagParser:
        return BagParser(bag_path=bag_path, config=self._config)

    def create_indexer(self, bag_path: str) -> Indexer:
        return Indexer(
            bag_path=bag_path,
            config=self._config,
            model=self._embedding_model,
            processor=self._embedding_processor,
        )

    def create_global_searcher(self) -> GlobalSearcher:
        return GlobalSearcher(
            config=self._config,
            model=self._embedding_model,
            processor=self._embedding_processor,
        )

    def create_video_chat(self, bag_path: str) -> VideoChat:
        return VideoChat(bag_path=bag_path, config=self._config)