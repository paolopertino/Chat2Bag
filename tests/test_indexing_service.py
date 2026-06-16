from pathlib import Path

from src.services.indexing_service import IndexingService


class ExplodingParser:
    def extract_frames(self) -> None:
        raise Exception("Some database files are missing")


class UnusedIndexer:
    db_path = Path("/tmp/unused")

    def build_index(self) -> None:
        raise AssertionError("indexer should not run after parser failure")


class ExplodingFactory:
    def create_bag_parser(self, bag_path: str) -> ExplodingParser:
        _ = bag_path
        return ExplodingParser()

    def create_indexer(self, bag_path: str) -> UnusedIndexer:
        _ = bag_path
        return UnusedIndexer()


from src.core.index_manifest import is_indexed, write_index_manifest
from src.core.storage import resolve_artifact_path


def test_index_bag_delete_at_start_clears_manifest_on_failure(tmp_path: Path) -> None:
    bag_dir = tmp_path / "broken_bag"
    bag_dir.mkdir()
    # A stale manifest from a prior successful run.
    artifact = resolve_artifact_path(bag_dir)
    write_index_manifest(
        artifact, embedder_name="old", embedder_dim=4,
        frame_count=5, cameras=["/c"], region_index=False,
    )
    assert is_indexed(artifact) is True

    service = IndexingService(
        factory=ExplodingFactory(),  # type: ignore[arg-type]
        status_store={},
        error_store={},
    )
    # Parser explodes before build_index() ever runs.
    service.index_bag(str(bag_dir))

    assert is_indexed(artifact) is False


def test_index_bag_marks_unexpected_parser_failure_as_error(tmp_path: Path) -> None:
    bag_dir = tmp_path / "broken_bag"
    bag_dir.mkdir()
    status_store: dict[str, str] = {}
    error_store: dict[str, str] = {}
    service = IndexingService(
        factory=ExplodingFactory(),  # type: ignore[arg-type]
        status_store=status_store,
        error_store=error_store,
    )

    service.index_bag(str(bag_dir))

    resolved = str(bag_dir.resolve())
    assert status_store[resolved] == "error"
    assert error_store[resolved] == "Some database files are missing"
