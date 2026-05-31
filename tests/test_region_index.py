import numpy as np

from src.region.faiss_index import FaissPatchIndex


def _planted_vectors(n_frames: int, patches_per_frame: int, dim: int, seed: int = 0):
    rng = np.random.default_rng(seed)
    vecs = rng.standard_normal((n_frames * patches_per_frame, dim)).astype(np.float32)
    vecs /= np.linalg.norm(vecs, axis=1, keepdims=True)
    frame_ids = np.repeat(np.arange(n_frames, dtype=np.int32), patches_per_frame)
    return vecs, frame_ids


def test_flatip_tier_recovers_planted_nearest_frame(tmp_path):
    # Below min_patches_for_pq → exact IndexFlatIP.
    vecs, frame_ids = _planted_vectors(n_frames=5, patches_per_frame=10, dim=16)
    idx = FaissPatchIndex(dim=16, min_patches_for_pq=10_000)
    idx.train_add(vecs, frame_ids)

    q = vecs[37]  # belongs to frame 3
    got_frames, scores = idx.search(q, k=1)
    assert got_frames[0] == frame_ids[37]
    assert scores[0] > 0.99  # exact self-match cosine ~1


def test_ivfpq_tier_persist_load_search(tmp_path):
    vecs, frame_ids = _planted_vectors(n_frames=60, patches_per_frame=400, dim=32)  # 24k patches
    idx = FaissPatchIndex(dim=32, min_patches_for_pq=10_000, pq_m=8, pq_nbits=8, ivf_nprobe=16)
    idx.train_add(vecs, frame_ids)
    idx.persist(tmp_path)

    loaded = FaissPatchIndex.load(tmp_path, mmap=True)
    q = vecs[5000]
    got_frames, scores = loaded.search(q, k=5)
    assert frame_ids[5000] in got_frames  # planted frame in top-5 patches


def test_persisted_files_exist(tmp_path):
    vecs, frame_ids = _planted_vectors(n_frames=5, patches_per_frame=10, dim=16)
    idx = FaissPatchIndex(dim=16, min_patches_for_pq=10_000)
    idx.train_add(vecs, frame_ids)
    idx.persist(tmp_path)
    assert (tmp_path / "patches.faiss").exists()
    assert (tmp_path / "patch_frames.npy").exists()
