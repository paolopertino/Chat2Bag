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
