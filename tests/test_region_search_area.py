import json

import numpy as np

from src.core.app_config import get_app_config
from src.region.faiss_index import FaissPatchIndex
from src.region.region_search import RegionSearcher
from tests.fakes import FakeDenseEmbedder


def _unit(dim, i):
    v = np.zeros(dim, dtype=np.float32)
    v[i] = 1.0
    return v


def _make_bag(tmp_path, frames, patch_vecs_per_frame, dim):
    bag = tmp_path / "bag"
    artifact = bag / ".bag_chat"
    region = artifact / "region"
    region.mkdir(parents=True)
    vecs, frame_ids = [], []
    for fid, pv in enumerate(patch_vecs_per_frame):
        vecs.append(pv.astype(np.float32))
        frame_ids.extend([fid] * pv.shape[0])
    idx = FaissPatchIndex(dim=dim, min_patches_for_pq=10_000)
    idx.train_add(np.concatenate(vecs), np.asarray(frame_ids, dtype=np.int32))
    idx.persist(region)
    meta = {
        "schema_version": 5, "cameras": ["/c"],
        "embedder": {"name": "fake-dense:test", "dim": dim},
        "region_index": {"engine": "faiss", "embedder_name": "fake-dense:test", "dim": dim,
                         "feature": "value-attention", "encode_long_side": 56,
                         "pq": {"m": 64, "nbits": 8}, "patch_count": len(frame_ids)},
        "frames": frames,
    }
    (artifact / "metadata.json").write_text(json.dumps(meta))
    return str(bag)


def test_region_search_area_restricts_to_in_area_frames(tmp_path):
    dim = 8
    frames = [
        {"timestamp_ns": 1, "topic": "/c", "file_path": "f0.jpg", "lat": 45.0, "lon": 10.0},  # inside
        {"timestamp_ns": 30_000_000_001, "topic": "/c", "file_path": "f1.jpg", "lat": 48.0, "lon": 12.0},  # outside
    ]
    # frame 1 (outside) is the best match for the query basis vector 1.
    bag = _make_bag(tmp_path, frames, [np.stack([_unit(dim, 0)]), np.stack([_unit(dim, 1)])], dim)
    searcher = RegionSearcher(config=get_app_config(), embedder=FakeDenseEmbedder(dim=dim))
    q = _unit(dim, 1)
    area = {"kind": "circle", "center": {"lat": 45.0, "lon": 10.0}, "radius_m": 200}
    results = searcher.search_by_q(q, [bag], top_k=5, area=area)
    assert {r["file_path"].split("/")[-1] for r in results} == {"f0.jpg"}  # outside frame excluded
