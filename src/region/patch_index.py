from pathlib import Path
from typing import Protocol, runtime_checkable

import numpy as np


@runtime_checkable
class PatchIndex(Protocol):
    """Per-bag patch vector index. Stores patch codes + a patch_id→frame_id map.

    Vectors are L2-normalized; similarity is cosine via inner product.
    """

    def train_add(self, vectors: np.ndarray, frame_ids: np.ndarray) -> None:
        """Build from (N, dim) float32 vectors and a parallel (N,) int32 frame_ids."""
        ...

    def persist(self, path: Path) -> None:
        """Write index + side arrays into directory `path`."""
        ...

    @classmethod
    def load(cls, path: Path, *, mmap: bool = True) -> "PatchIndex":
        ...

    def search(self, q: np.ndarray, k: int) -> tuple[np.ndarray, np.ndarray]:
        """For a single (dim,) query, return (frame_ids (k,), scores (k,)) for the
        top-k matching Patches (cosine). frame_ids may repeat across patches."""
        ...
