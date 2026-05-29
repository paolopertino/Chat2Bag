import numpy as np
from PIL import Image

from src.embedding import FrameEmbedder


class FakeEmbedder(FrameEmbedder):
    """Deterministic test double: emits unit basis vectors of the configured dim."""

    def __init__(self, dim: int = 4, name: str = "fake:test"):
        self._dim = dim
        self._name = name

    @property
    def name(self) -> str:
        return self._name

    @property
    def embedding_dim(self) -> int:
        return self._dim

    @property
    def capabilities(self) -> frozenset[str]:
        return frozenset({"global", "text"})

    def embed_images(self, images: list[Image.Image]) -> np.ndarray:
        rows = [np.eye(self._dim, dtype=np.float32)[i % self._dim] for i in range(len(images))]
        return np.stack(rows, axis=0) if rows else np.zeros((0, self._dim), dtype=np.float32)

    def embed_text(self, queries: list[str]) -> np.ndarray:
        rows = [np.eye(self._dim, dtype=np.float32)[0] for _ in queries]
        return np.stack(rows, axis=0) if rows else np.zeros((0, self._dim), dtype=np.float32)

    def to(self, device: str) -> "FakeEmbedder":
        return self

    def offload(self) -> None:
        return None
