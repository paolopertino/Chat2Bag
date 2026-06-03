import logging
from pathlib import Path

import numpy as np

from src.core.app_config import RegionSearchConfig
from src.region.faiss_index import FaissPatchIndex

logger = logging.getLogger(__name__)


class DensePatchIndexer:
    """Accumulates per-frame patch grids to a disk spill file, then builds a
    FaissPatchIndex. Never holds all patches in RAM (the spill is mmap-read)."""

    def __init__(self, region_dir: Path, dim: int, region_config: RegionSearchConfig):
        self._region_dir = Path(region_dir)
        self._region_dir.mkdir(parents=True, exist_ok=True)
        self._dim = int(dim)
        self._cfg = region_config
        self._spill_path = self._region_dir / ".patches_spill.f32"
        self._spill = open(self._spill_path, "wb")
        self._frame_ids: list[int] = []
        self._count = 0

    @property
    def pq_params(self) -> dict:
        return {"m": self._cfg.pq_m, "nbits": self._cfg.pq_nbits}

    def add_frame(self, frame_id: int, grid: np.ndarray) -> None:
        """grid: (H_p, W_p, dim) float32, L2-normalized per patch."""
        flat = np.ascontiguousarray(grid.reshape(-1, self._dim), dtype=np.float32)
        flat.tofile(self._spill)
        self._frame_ids.extend([int(frame_id)] * flat.shape[0])
        self._count += flat.shape[0]

    def finalize(self) -> int:
        """Build + persist the faiss index. Returns total patch_count."""
        self._spill.close()
        if self._count == 0:
            logger.warning("DensePatchIndexer: no patches accumulated; nothing built.")
            return 0

        vectors = np.memmap(self._spill_path, dtype=np.float32, mode="r", shape=(self._count, self._dim))
        frame_ids = np.asarray(self._frame_ids, dtype=np.int32)

        index = FaissPatchIndex(
            dim=self._dim,
            min_patches_for_pq=self._cfg.min_patches_for_pq,
            pq_m=self._cfg.pq_m,
            pq_nbits=self._cfg.pq_nbits,
            ivf_nlist=self._cfg.ivf_nlist,
            ivf_nprobe=self._cfg.ivf_nprobe,
            train_sample_cap=self._cfg.train_sample_cap,
        )
        index.train_add(vectors, frame_ids)
        index.persist(self._region_dir)

        del vectors  # release the memmap before deleting the spill
        self._spill_path.unlink(missing_ok=True)
        return self._count
