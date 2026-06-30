"""Consumer-side embedding policy: L2-normalize the library's raw outputs.

The library's :class:`FrameEmbedder` returns raw model vectors (normalization is
the consumer's policy). Chat2Bag works in cosine space: stored vectors and queries
are unit-norm, and Region search treats raw inner products as cosine. This decorator
wraps any library embedder and L2-normalizes every output at a single seam, so all
call sites keep that invariant and existing indexes stay valid.
"""

import threading

import numpy as np
from PIL import Image

from data_extraction_lib.embedding import FrameEmbedder


def _l2(rows: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(rows, axis=-1, keepdims=True)
    return (rows / np.where(norms == 0, 1.0, norms)).astype(np.float32)


class NormalizingEmbedder(FrameEmbedder):
    """Wraps a :class:`FrameEmbedder`, L2-normalizes all of its outputs, and serializes
    its model forwards.

    The inner embedder is shared process-wide and is not safe for concurrent forwards
    (some backends register transient forward hooks on shared modules). A lock held
    across each ``embed_*`` delegation guarantees one forward at a time, which a single
    GPU executes serially anyway; the L2 normalization runs outside the lock.
    """

    def __init__(self, inner: FrameEmbedder):
        self._inner = inner
        self._lock = threading.Lock()

    @property
    def name(self) -> str:
        return self._inner.name

    @property
    def embedding_dim(self) -> int:
        return self._inner.embedding_dim

    @property
    def capabilities(self) -> frozenset[str]:
        return self._inner.capabilities

    @property
    def encode_long_side(self) -> int | None:
        return self._inner.encode_long_side

    def embed_images(self, images: list[Image.Image]) -> np.ndarray:
        with self._lock:
            raw = self._inner.embed_images(images)
        return _l2(raw)

    def embed_text(self, queries: list[str]) -> np.ndarray:
        with self._lock:
            raw = self._inner.embed_text(queries)
        return _l2(raw)

    def embed_dense(self, images: list[Image.Image]) -> list[tuple[np.ndarray, np.ndarray]]:
        with self._lock:
            raw = self._inner.embed_dense(images)
        return [(_l2(cls), _l2(grid)) for cls, grid in raw]

    def embed_dense_value(self, images: list[Image.Image]) -> list[tuple[np.ndarray, np.ndarray]]:
        with self._lock:
            raw = self._inner.embed_dense_value(images)
        return [(_l2(cls), _l2(grid)) for cls, grid in raw]

    def to(self, device: str) -> "NormalizingEmbedder":
        self._inner.to(device)
        return self

    def offload(self) -> None:
        self._inner.offload()
