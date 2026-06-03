import json

from src.retriever.global_search import GlobalSearcher
from tests.fakes import FakeEmbedder


def _bag_with_stamp(tmp_path, name, stamp):
    bag = tmp_path / name
    artifact = bag / ".bag_chat"
    artifact.mkdir(parents=True)
    (artifact / "metadata.json").write_text(
        json.dumps({"schema_version": 3, "frames": [], "embedder": stamp})
    )
    return str(bag)


def test_compatible_bags_filters_by_stamp(tmp_path):
    # Default config uses storage_path=null -> artifact at <bag>/.bag_chat
    searcher = GlobalSearcher.__new__(GlobalSearcher)
    searcher._embedder = FakeEmbedder(dim=4, name="fake:test")

    match = _bag_with_stamp(tmp_path, "match", {"name": "fake:test", "dim": 4})
    wrong_name = _bag_with_stamp(tmp_path, "wrong_name", {"name": "other", "dim": 4})
    wrong_dim = _bag_with_stamp(tmp_path, "wrong_dim", {"name": "fake:test", "dim": 8})
    unstamped = _bag_with_stamp(tmp_path, "unstamped", None)

    keep = searcher._compatible_bags([match, wrong_name, wrong_dim, unstamped])

    assert keep == [match]
