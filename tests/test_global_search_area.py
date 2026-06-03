import json

import lancedb
import numpy as np

from src.core.app_config import get_app_config
from src.core.storage import resolve_artifact_path
from src.retriever.global_search import GlobalSearcher
from tests.fakes import FakeEmbedder


def _build_bag(tmp_path):
    cfg = get_app_config()
    bag = tmp_path / "bag"
    artifact = resolve_artifact_path(bag_path=bag)
    (artifact / "lancedb").mkdir(parents=True)
    dim = 4
    # 3 frames; frame 0 is inside the area, frames 1,2 outside. Timestamps 30s apart to avoid temporal dedup.
    S = 30_000_000_000
    frames = [
        {"timestamp_ns": 0 * S, "topic": "/c", "file_path": "f0.jpg", "lat": 45.0, "lon": 10.0},
        {"timestamp_ns": 1 * S, "topic": "/c", "file_path": "f1.jpg", "lat": 48.0, "lon": 12.0},
        {"timestamp_ns": 2 * S, "topic": "/c", "file_path": "f2.jpg", "lat": 48.1, "lon": 12.1},
    ]
    meta = {"schema_version": 5, "cameras": ["/c"],
            "embedder": {"name": "fake:test", "dim": dim}, "frames": frames}
    (artifact / "metadata.json").write_text(json.dumps(meta))

    # vectors: frame 1 is the best match for the query; frame 0 (in-area) is second.
    vecs = np.array([[0.9, 0.1, 0, 0], [1.0, 0, 0, 0], [0.0, 1.0, 0, 0]], dtype=np.float32)
    S = 30_000_000_000
    db = lancedb.connect(str(artifact / "lancedb"))
    db.create_table("frames", data=[
        {"timestamp_ns": i * S, "topic": "/c",
         "file_path": frames[i]["file_path"], "vector": vecs[i].tolist()}
        for i in range(3)
    ], mode="overwrite")
    return cfg, str(bag)


def test_area_prefilters_global_search(tmp_path):
    cfg, bag = _build_bag(tmp_path)
    searcher = GlobalSearcher(config=cfg, embedder=FakeEmbedder(dim=4, name="fake:test"))
    q = [1.0, 0.0, 0.0, 0.0]  # closest to frame 1 (outside the area)

    area = {"kind": "circle", "center": {"lat": 45.0, "lon": 10.0}, "radius_m": 200}
    results = searcher._search_vector(query_vector=q, bag_paths=[bag], top_k=5, area=area)

    # Only the in-area frame survives the prefilter.
    assert {r["file_path"] for r in results} == {"f0.jpg"}


def test_no_area_returns_all(tmp_path):
    cfg, bag = _build_bag(tmp_path)
    searcher = GlobalSearcher(config=cfg, embedder=FakeEmbedder(dim=4, name="fake:test"))
    results = searcher._search_vector(query_vector=[1.0, 0, 0, 0], bag_paths=[bag], top_k=5)
    assert len(results) == 3
