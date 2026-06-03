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
        """Subset of {'global', 'text', 'dense'}. 'dense' enables Region search."""

    @abstractmethod
    def embed_images(self, images: list[Image.Image]) -> np.ndarray:
        """(N, dim) float32, L2-normalized."""

    @abstractmethod
    def embed_text(self, queries: list[str]) -> np.ndarray:
        """(N, dim) float32, L2-normalized. Raw query text in; no caller-side templating."""

    @property
    def encode_long_side(self) -> int | None:
        """Dense encode geometry (long edge, ÷patch). None if the backend has no
        manual encode resolution. Region search reads this to stamp/validate."""
        return None

    def embed_dense(self, images: list[Image.Image]) -> list[np.ndarray]:
        """Region-search seam. One (H_p, W_p, dim) float32 array per image,
        L2-normalized per Patch. Grids vary per image (aspect-preserving ÷patch)."""
        raise NotImplementedError(f"{self.name} does not implement dense/region embeddings")

    def embed_global_and_dense(
        self, images: list[Image.Image]
    ) -> list[tuple[np.ndarray, np.ndarray]]:
        """One trunk pass per image → (cls (dim,), grid (H_p, W_p, dim)), both
        L2-normalized. Used by the fused fresh-index loop."""
        raise NotImplementedError(f"{self.name} does not implement fused dense embeddings")

    @abstractmethod
    def to(self, device: str) -> "FrameEmbedder":
        """Move underlying model(s) to a compute device. Returns self for chaining."""

    @abstractmethod
    def offload(self) -> None:
        """Move to CPU and release VRAM."""
