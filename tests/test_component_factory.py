import dataclasses

import numpy as np
from PIL import Image

from data_extraction_lib.embedding import FrameEmbedder
from data_extraction_lib.index import BagIndexBuilder, DenseSearch, GlobalSearch

from src.core.app_config import get_app_config
from src.services.component_factory import BackendComponentFactory


class _FakeEmbedder(FrameEmbedder):
    """Minimal test double with configurable capabilities."""

    def __init__(self, capabilities: set[str], dim: int = 8) -> None:
        self._capabilities = frozenset(capabilities)
        self._dim = dim

    @property
    def name(self) -> str:
        return "fake:test"

    @property
    def embedding_dim(self) -> int:
        return self._dim

    @property
    def capabilities(self) -> frozenset[str]:
        return self._capabilities

    def embed_images(self, images: list[Image.Image]) -> np.ndarray:
        return np.zeros((len(images), self._dim), dtype=np.float32)

    def embed_text(self, queries: list[str]) -> np.ndarray:
        return np.zeros((len(queries), self._dim), dtype=np.float32)

    def to(self, device: str) -> "_FakeEmbedder":
        return self

    def offload(self) -> None:
        pass


def _make_config(*, region_enabled: bool):
    cfg = get_app_config()
    return dataclasses.replace(
        cfg,
        region_search=dataclasses.replace(cfg.region_search, enabled=region_enabled),
    )


def test_factory_builds_index_components(tmp_path):
    config = _make_config(region_enabled=True)
    embedder = _FakeEmbedder(capabilities={"global", "text", "dense"})
    factory = BackendComponentFactory(config, embedder)

    assert isinstance(factory.create_global_search(), GlobalSearch)
    assert isinstance(factory.create_dense_search(), DenseSearch)
    assert isinstance(factory.create_bag_index_builder(str(tmp_path)), BagIndexBuilder)


def test_dense_search_none_when_region_disabled():
    config = _make_config(region_enabled=False)
    embedder = _FakeEmbedder(capabilities={"global", "text"})
    factory = BackendComponentFactory(config, embedder)

    assert factory.create_dense_search() is None


def test_dense_search_none_when_embedder_lacks_dense():
    config = _make_config(region_enabled=True)
    embedder = _FakeEmbedder(capabilities={"global", "text"})
    factory = BackendComponentFactory(config, embedder)

    assert factory.create_dense_search() is None
