import dataclasses
import json

import numpy as np
from PIL import Image

from src.core.app_config import get_app_config
from src.region.faiss_index import FaissPatchIndex
from src.region.region_search import RegionSearcher
from tests.fakes import FakeDenseEmbedder


def _make_region_bag(bag_dir, frames, patch_vecs_per_frame, dim, artifact_name=".bag_chat"):
    """frames: list of {timestamp_ns, topic, file_path}. patch_vecs_per_frame: list of (P,dim)."""
    artifact = bag_dir / artifact_name
    region = artifact / "region"
    region.mkdir(parents=True)
    vecs, frame_ids = [], []
    for fid, pv in enumerate(patch_vecs_per_frame):
        vecs.append(pv.astype(np.float32))
        frame_ids.extend([fid] * pv.shape[0])
    vecs = np.concatenate(vecs, axis=0)
    idx = FaissPatchIndex(dim=dim, min_patches_for_pq=10_000)  # tiny → FlatIP
    idx.train_add(vecs, np.asarray(frame_ids, dtype=np.int32))
    idx.persist(region)
    meta = {
        "schema_version": 4,
        "cameras": sorted({f["topic"] for f in frames}),
        "embedder": {"name": "fake-dense:test", "dim": dim},
        "region_index": {
            "engine": "faiss", "embedder_name": "fake-dense:test", "dim": dim,
            "feature": "value-attention", "encode_long_side": 56,
            "pq": {"m": 64, "nbits": 8}, "patch_count": int(vecs.shape[0]),
        },
        "frames": frames,
    }
    (artifact / "metadata.json").write_text(json.dumps(meta))
    return str(bag_dir)


def _unit(dim, axis):
    v = np.zeros(dim, dtype=np.float32)
    v[axis] = 1.0
    return v


def test_maxsim_groups_patches_by_frame(tmp_path):
    dim = 8
    bag = tmp_path / "bag1"
    bag.mkdir()
    f0 = np.stack([_unit(dim, 2), _unit(dim, 7)])
    f1 = np.stack([_unit(dim, 5), _unit(dim, 5)])
    frames = [
        {"timestamp_ns": 10, "topic": "/cam/a", "file_path": "thumbnails/cam_a/frame_10.jpg"},
        {"timestamp_ns": 20, "topic": "/cam/a", "file_path": "thumbnails/cam_a/frame_20.jpg"},
    ]
    bag_path = _make_region_bag(bag, frames, [f0, f1], dim)

    cfg = get_app_config()
    searcher = RegionSearcher(config=cfg, embedder=FakeDenseEmbedder(dim=dim))
    results = searcher.search_by_q(_unit(dim, 2), [bag_path], top_k=5)
    assert results[0]["timestamp_ns"] == 10  # frame 0 (axis 2) ranks first
    assert results[0]["topic"] == "/cam/a"
    assert "similarity_score" in results[0]
    assert "bag_path" in results[0] and "source_bag" in results[0]


def test_self_exclude_drops_support_frame(tmp_path):
    dim = 8
    bag = tmp_path / "bag2"
    bag.mkdir()
    f0 = np.stack([_unit(dim, 2)])
    frames = [{"timestamp_ns": 10, "topic": "/cam/a", "file_path": "thumbnails/cam_a/frame_10.jpg"}]
    bag_path = _make_region_bag(bag, frames, [f0], dim)
    abs_support = str(tmp_path / "bag2" / ".bag_chat" / "thumbnails/cam_a/frame_10.jpg")

    cfg = get_app_config()
    searcher = RegionSearcher(config=cfg, embedder=FakeDenseEmbedder(dim=dim))
    results = searcher.search_by_q(_unit(dim, 2), [bag_path], top_k=5, exclude_file_path=abs_support)
    assert results == []


def test_skips_bag_without_region_index(tmp_path):
    bag = tmp_path / "bag3"
    artifact = bag / ".bag_chat"
    artifact.mkdir(parents=True)
    (artifact / "metadata.json").write_text(json.dumps({
        "schema_version": 4, "cameras": ["/cam/a"],
        "embedder": {"name": "fake-dense:test", "dim": 8},
        "region_index": None,
        "frames": [{"timestamp_ns": 1, "topic": "/cam/a", "file_path": "x.jpg"}],
    }))
    cfg = get_app_config()
    searcher = RegionSearcher(config=cfg, embedder=FakeDenseEmbedder(dim=8))
    assert searcher.search_by_q(_unit(8, 0), [str(bag)], top_k=5) == []


def test_refine_recomputes_top_frame(tmp_path):
    dim = 4
    bag = tmp_path / "bagR"
    bag.mkdir()
    artifact = bag / ".bag_chat"
    (artifact / "thumbnails" / "cam_a").mkdir(parents=True)
    Image.new("RGB", (60, 40)).save(artifact / "thumbnails/cam_a/frame_10.jpg")
    f0 = np.stack([_unit(dim, 0)])
    frames = [{"timestamp_ns": 10, "topic": "/cam/a", "file_path": "thumbnails/cam_a/frame_10.jpg"}]
    bag_path = _make_region_bag(bag, frames, [f0], dim)

    base = get_app_config()
    # Fresh config with refine on — do NOT mutate the lru-cached AppConfig in place.
    cfg = dataclasses.replace(
        base, region_search=dataclasses.replace(base.region_search, refine_enabled=True)
    )
    searcher = RegionSearcher(config=cfg, embedder=FakeDenseEmbedder(dim=dim))

    calls = {"n": 0}
    orig = searcher._embedder.embed_dense

    def _spy(imgs):
        calls["n"] += 1
        return orig(imgs)

    searcher._embedder.embed_dense = _spy
    results = searcher.search_by_q(_unit(dim, 0), [bag_path], top_k=5)
    assert calls["n"] >= 1  # refine recomputed the top frame from its thumbnail
    assert results[0]["timestamp_ns"] == 10


def test_heatmap_returns_grid_and_dims(tmp_path):
    dim = 4
    bag = tmp_path / "bagH"
    artifact = bag / ".bag_chat"
    (artifact / "thumbnails" / "cam_a").mkdir(parents=True)
    Image.new("RGB", (60, 40)).save(artifact / "thumbnails/cam_a/frame_10.jpg")
    target = str(artifact / "thumbnails/cam_a/frame_10.jpg")

    cfg = get_app_config()
    searcher = RegionSearcher(config=cfg, embedder=FakeDenseEmbedder(dim=dim))
    out = searcher.heatmap(_unit(dim, 0), target)
    assert out["height"] == 2 and out["width"] == 3  # FakeDenseEmbedder grid is (2,3,dim)
    assert len(out["grid"]) == 2 and len(out["grid"][0]) == 3
