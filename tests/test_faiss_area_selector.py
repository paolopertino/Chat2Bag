import numpy as np

from src.region.faiss_index import FaissPatchIndex


def _unit(dim, i):
    v = np.zeros(dim, dtype=np.float32)
    v[i] = 1.0
    return v


def test_selector_restricts_results_to_allowed_frames():
    dim = 8
    # 3 frames, 2 patches each. frame f's patches point at basis vector f.
    vecs, frame_ids = [], []
    for f in range(3):
        for _ in range(2):
            vecs.append(_unit(dim, f))
            frame_ids.append(f)
    idx = FaissPatchIndex(dim=dim, min_patches_for_pq=10_000)  # tiny -> IndexFlatIP
    idx.train_add(np.stack(vecs), np.asarray(frame_ids, dtype=np.int32))

    q = _unit(dim, 1)  # best match is frame 1
    # Unrestricted: frame 1 wins.
    fids, _ = idx.search(q, k=6)
    assert 1 in set(fids.tolist())
    # Restricted to frames {0, 2}: frame 1 must NOT appear.
    fids2, _ = idx.search(q, k=6, allowed_frame_ids={0, 2})
    assert set(fids2.tolist()).issubset({0, 2})
    assert fids2.size > 0


def test_empty_allowed_returns_empty():
    dim = 4
    idx = FaissPatchIndex(dim=dim, min_patches_for_pq=10_000)
    idx.train_add(np.stack([_unit(dim, 0), _unit(dim, 1)]), np.asarray([0, 1], dtype=np.int32))
    fids, scores = idx.search(_unit(dim, 0), k=2, allowed_frame_ids=set())
    assert fids.size == 0 and scores.size == 0
