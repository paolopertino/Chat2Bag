import json

import lancedb
from PIL import Image

from src.core.app_config import get_app_config
from data_extraction_lib.artifacts import BagArtifacts, EmbedderStamp, IndexManifest, Metadata
from src.ingestion.indexer import Indexer
from src.region.dense_indexer import DensePatchIndexer
from tests.fakes import FakeDenseEmbedder, FakeEmbedder


def _make_bag(tmp_path):
    cfg = get_app_config()  # default settings: storage_path null -> artifact under bag dir
    bag = tmp_path / "mybag"
    bag.mkdir(parents=True)
    artifact = bag / cfg.storage.artifact_dir
    (artifact / "thumbnails" / "cam_a").mkdir(parents=True)
    rel = "thumbnails/cam_a/frame_1.jpg"
    Image.new("RGB", (16, 16)).save(artifact / rel)
    meta = {
        "schema_version": 4,
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


def _cls_rows(db_path):
    # Compare embedding-relevant fields (vector, topic, timestamp). file_path is dropped
    # because it is the bag's absolute location and legitimately differs across bags.
    db = lancedb.connect(str(db_path))
    rows = db.open_table("frames").to_arrow().to_pylist()
    for r in rows:
        r.pop("file_path", None)
    return sorted(rows, key=lambda r: (r["topic"], r["timestamp_ns"]))


def test_fused_index_builds_region_index_and_stamps(tmp_path):
    cfg, bag, artifact = _make_bag(tmp_path)
    emb = FakeDenseEmbedder(dim=4)
    region_indexer = DensePatchIndexer(
        region_dir=artifact / "region", dim=4, region_config=cfg.region_search
    )
    indexer = Indexer(bag_path=str(bag), config=cfg, embedder=emb, region_indexer=region_indexer)
    indexer.build_index()

    assert (artifact / "region" / "patches.faiss").exists()
    meta = Metadata.load(BagArtifacts(artifact))
    stamp = meta.region_index
    assert stamp is not None
    assert stamp.embedder_name == "fake-dense:test"
    assert stamp.feature == "value-attention"
    assert stamp.encode_long_side == 56
    assert stamp.patch_count == 6  # 1 frame × 6 patches


def test_fused_cls_rows_match_standalone(tmp_path):
    cfg_a, bag_a, art_a = _make_bag(tmp_path / "a")
    cfg_b, bag_b, art_b = _make_bag(tmp_path / "b")

    # Standalone CLS-only (no region indexer).
    Indexer(bag_path=str(bag_a), config=cfg_a, embedder=FakeDenseEmbedder(dim=4)).build_index()

    # Fused (with region indexer).
    Indexer(
        bag_path=str(bag_b), config=cfg_b, embedder=FakeDenseEmbedder(dim=4),
        region_indexer=DensePatchIndexer(region_dir=art_b / "region", dim=4, region_config=cfg_b.region_search),
    ).build_index()

    assert _cls_rows(art_a / "lancedb") == _cls_rows(art_b / "lancedb")


def test_build_index_writes_manifest_on_success(tmp_path):
    cfg, bag, artifact = _make_bag(tmp_path)
    Indexer(str(bag), config=cfg, embedder=FakeEmbedder(dim=4, name="fake:test")).build_index()
    data = IndexManifest.read(BagArtifacts(artifact))
    assert data is not None
    assert data.embedder == EmbedderStamp("fake:test", 4)
    assert data.frame_count == 1
    assert data.cameras == ["/cam/a"]
    assert data.region_index is False


def test_build_index_manifest_marks_region(tmp_path):
    cfg, bag, artifact = _make_bag(tmp_path)
    region_indexer = DensePatchIndexer(
        region_dir=artifact / "region", dim=4, region_config=cfg.region_search
    )
    Indexer(
        str(bag), config=cfg, embedder=FakeDenseEmbedder(dim=4), region_indexer=region_indexer
    ).build_index()
    assert IndexManifest.read(BagArtifacts(artifact)).region_index is True


def test_build_index_no_manifest_when_no_frames(tmp_path):
    cfg, bag, artifact = _make_bag(tmp_path)
    meta = json.loads((artifact / "metadata.json").read_text())
    meta["frames"] = []  # forces the "No frames found" early return
    (artifact / "metadata.json").write_text(json.dumps(meta))
    Indexer(str(bag), config=cfg, embedder=FakeEmbedder(dim=4)).build_index()
    assert IndexManifest.is_indexed(BagArtifacts(artifact)) is False


def test_build_index_delete_at_start_clears_stale_manifest(tmp_path):
    cfg, bag, artifact = _make_bag(tmp_path)
    IndexManifest(
        embedder=EmbedderStamp("stale", 4), frame_count=99, cameras=["/old"], region_index=False,
    ).write(BagArtifacts(artifact))
    # No frames -> early return without rewriting; delete-at-start must still clear it.
    meta = json.loads((artifact / "metadata.json").read_text())
    meta["frames"] = []
    (artifact / "metadata.json").write_text(json.dumps(meta))
    Indexer(str(bag), config=cfg, embedder=FakeEmbedder(dim=4)).build_index()
    assert IndexManifest.is_indexed(BagArtifacts(artifact)) is False
