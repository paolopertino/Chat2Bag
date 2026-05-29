import json

import lancedb
from PIL import Image

from src.core.app_config import get_app_config
from src.ingestion.indexer import Indexer
from tests.fakes import FakeEmbedder


def _make_bag(tmp_path):
    cfg = get_app_config()  # default settings: storage_path null -> artifact under bag dir
    bag = tmp_path / "mybag"
    bag.mkdir()
    artifact = bag / cfg.storage.artifact_dir
    (artifact / "thumbnails" / "cam_a").mkdir(parents=True)
    rel = "thumbnails/cam_a/frame_1.jpg"
    Image.new("RGB", (16, 16)).save(artifact / rel)
    meta = {
        "schema_version": 3,
        "bag_name": "mybag",
        "cameras": ["/cam/a"],
        "embedder": None,
        "frames": [{"timestamp_ns": 1, "topic": "/cam/a", "file_path": rel}],
    }
    (artifact / "metadata.json").write_text(json.dumps(meta))
    return cfg, bag, artifact


def test_indexer_embeds_writes_per_frame_topic_and_stamps(tmp_path):
    cfg, bag, artifact = _make_bag(tmp_path)
    embedder = FakeEmbedder(dim=4, name="fake:test")

    Indexer(str(bag), config=cfg, embedder=embedder).build_index()

    # 1. Stamp written into metadata.json
    new_meta = json.loads((artifact / "metadata.json").read_text())
    assert new_meta["embedder"] == {"name": "fake:test", "dim": 4}

    # 2. LanceDB row carries the per-frame topic and a 4-d vector
    table = lancedb.connect(str(artifact / "lancedb")).open_table("frames")
    rows = table.to_arrow().to_pylist()
    assert len(rows) == 1
    assert rows[0]["topic"] == "/cam/a"
    assert rows[0]["timestamp_ns"] == 1
    assert len(rows[0]["vector"]) == 4
