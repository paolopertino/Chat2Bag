from abc import ABC, abstractmethod

import numpy as np
from PIL import Image


class FrameEmbedder(ABC):
    """Framework-neutral embedding contract.

    Inputs are PIL images / raw query strings. Outputs are float32 numpy arrays
    of shape (N, embedding_dim), L2-normalized along the last axis — callers feed
    them straight into LanceDB cosine search. Subclasses own all model-specific
    preprocessing, batching, and device placement.
    """

    @property
    @abstractmethod
    def name(self) -> str:
        """Stable identity stamped into metadata.json, e.g. 'siglip2:google/...'."""

    @property
    @abstractmethod
    def embedding_dim(self) -> int:
        """Vector dimension this embedder emits."""

    @property
    @abstractmethod
    def capabilities(self) -> frozenset[str]:
        """Subset of {'global', 'text', 'dense'}. This effort ships {'global', 'text'}."""

    @abstractmethod
    def embed_images(self, images: list[Image.Image]) -> np.ndarray:
        """(N, dim) float32, L2-normalized."""

    @abstractmethod
    def embed_text(self, queries: list[str]) -> np.ndarray:
        """(N, dim) float32, L2-normalized. Raw query text in; no caller-side templating."""

    def embed_dense(self, images: list[Image.Image]) -> np.ndarray:
        """Documented seam for Region search; unimplemented until Region search is specced."""
        raise NotImplementedError(f"{self.name} does not implement dense/region embeddings")

    @abstractmethod
    def to(self, device: str) -> "FrameEmbedder":
        """Move underlying model(s) to a compute device. Returns self for chaining."""

    @abstractmethod
    def offload(self) -> None:
        """Move to CPU and release VRAM."""
