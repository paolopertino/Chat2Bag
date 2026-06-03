import logging
from pathlib import Path

import faiss
import numpy as np

logger = logging.getLogger(__name__)

_ADD_BATCH = 100_000


class FaissPatchIndex:
    """faiss patch index. IVF-PQ above `min_patches_for_pq`, exact IndexFlatIP below.

    Patch rows are added in order; row i's frame id is `_patch_frames[i]`. faiss
    returns row indices, which we map back to frame ids.
    """

    def __init__(
        self,
        dim: int,
        *,
        min_patches_for_pq: int = 10_000,
        pq_m: int = 64,
        pq_nbits: int = 8,
        ivf_nlist: int | None = None,
        ivf_nprobe: int = 16,
        train_sample_cap: int = 262_144,
    ):
        self._dim = int(dim)
        self._min_patches_for_pq = int(min_patches_for_pq)
        self._pq_m = int(pq_m)
        self._pq_nbits = int(pq_nbits)
        self._ivf_nlist = ivf_nlist
        self._ivf_nprobe = int(ivf_nprobe)
        self._train_sample_cap = int(train_sample_cap)
        self._index: faiss.Index | None = None
        self._patch_frames: np.ndarray | None = None

    def train_add(self, vectors: np.ndarray, frame_ids: np.ndarray) -> None:
        vectors = np.ascontiguousarray(vectors, dtype=np.float32)
        n = vectors.shape[0]
        assert vectors.shape[1] == self._dim, "dim mismatch"
        assert frame_ids.shape[0] == n, "frame_ids length mismatch"
        self._patch_frames = np.ascontiguousarray(frame_ids, dtype=np.int32)

        if n < self._min_patches_for_pq:
            logger.info("Patch index: %d patches < %d → exact IndexFlatIP", n, self._min_patches_for_pq)
            index = faiss.IndexFlatIP(self._dim)
            index.add(vectors)
            self._index = index
            return

        nlist = self._ivf_nlist if self._ivf_nlist else max(1, n // 4096)
        logger.info("Patch index: IVF-PQ nlist=%d m=%d nbits=%d on %d patches", nlist, self._pq_m, self._pq_nbits, n)
        quantizer = faiss.IndexFlatIP(self._dim)
        index = faiss.IndexIVFPQ(quantizer, self._dim, nlist, self._pq_m, self._pq_nbits, faiss.METRIC_INNER_PRODUCT)
        index.nprobe = self._ivf_nprobe

        # PQ training needs ~39*2^nbits points for its 256-centroid codebooks; floor the
        # sample there so small-but-PQ-eligible bags (small nlist) don't undertrain. Cap
        # for huge bags. Refines spec §3.2.
        train_floor = max(256 * nlist, 39 * (2 ** self._pq_nbits))
        train_size = min(n, train_floor, self._train_sample_cap)
        if train_size < n:
            rng = np.random.default_rng(0)
            sample_idx = rng.choice(n, size=train_size, replace=False)
            train_vecs = np.ascontiguousarray(vectors[sample_idx], dtype=np.float32)
        else:
            train_vecs = vectors
        index.train(train_vecs)

        for start in range(0, n, _ADD_BATCH):
            index.add(np.ascontiguousarray(vectors[start:start + _ADD_BATCH], dtype=np.float32))
        self._index = index

    def persist(self, path: Path) -> None:
        path = Path(path)
        path.mkdir(parents=True, exist_ok=True)
        assert self._index is not None and self._patch_frames is not None, "nothing to persist"
        faiss.write_index(self._index, str(path / "patches.faiss"))
        np.save(path / "patch_frames.npy", self._patch_frames)

    @classmethod
    def load(cls, path: Path, *, mmap: bool = True) -> "FaissPatchIndex":
        path = Path(path)
        flags = faiss.IO_FLAG_MMAP if mmap else 0
        index = faiss.read_index(str(path / "patches.faiss"), flags)
        patch_frames = np.load(path / "patch_frames.npy", mmap_mode="r" if mmap else None)
        obj = cls(dim=index.d)
        obj._index = index
        obj._patch_frames = patch_frames
        return obj

    def search(self, q: np.ndarray, k: int, *, allowed_frame_ids=None) -> tuple[np.ndarray, np.ndarray]:
        assert self._index is not None and self._patch_frames is not None, "index not built/loaded"
        q = np.ascontiguousarray(q.reshape(1, -1), dtype=np.float32)

        params = None
        if allowed_frame_ids is not None:
            allowed = np.fromiter((int(f) for f in allowed_frame_ids), dtype=np.int32)
            if allowed.size == 0:
                return np.empty(0, dtype=np.int32), np.empty(0, dtype=np.float32)
            rows = np.where(np.isin(np.asarray(self._patch_frames), allowed))[0].astype(np.int64)
            if rows.size == 0:
                return np.empty(0, dtype=np.int32), np.empty(0, dtype=np.float32)
            self._selector_rows = rows  # keep a reference alive for the C++ selector
            selector = faiss.IDSelectorBatch(rows)
            if isinstance(self._index, faiss.IndexIVF):
                params = faiss.SearchParametersIVF()
                params.nprobe = self._index.nlist  # exhaustive: restores small-Area recall (spike 2026-06-03)
                params.sel = selector
            else:
                params = faiss.SearchParameters()
                params.sel = selector

        k = min(int(k), self._index.ntotal)
        if params is not None:
            scores, rows_out = self._index.search(q, k, params=params)
        else:
            scores, rows_out = self._index.search(q, k)
        rows_out = rows_out[0]
        scores = scores[0]
        valid = rows_out >= 0
        rows_out = rows_out[valid]
        scores = scores[valid]
        frame_ids = np.asarray(self._patch_frames)[rows_out].astype(np.int32)
        return frame_ids, scores.astype(np.float32)
