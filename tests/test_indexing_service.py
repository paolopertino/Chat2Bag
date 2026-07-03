from pathlib import Path

from data_extraction_lib.artifacts import BagArtifacts, EmbedderStamp, IndexManifest
from chat2bag.core.storage import artifacts_for_bag
from chat2bag.services.indexing_service import IndexingService


# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------


class FakeExtractor:
    def extract(self) -> None:
        pass


class ExplodingExtractor:
    def extract(self) -> None:
        raise Exception("Some database files are missing")


class FakeBagIndexBuilder:
    def __init__(self) -> None:
        self.built = False

    def build(self) -> None:
        self.built = True


class ExplodingBagIndexBuilder:
    def build(self) -> None:
        raise AssertionError("builder should not run after extractor failure")


class FakeFactory:
    def __init__(self, builder: FakeBagIndexBuilder) -> None:
        self._builder = builder

    def create_bag_extractor(self, bag_path: str) -> FakeExtractor:
        _ = bag_path
        return FakeExtractor()

    def create_bag_index_builder(self, bag_path: str) -> FakeBagIndexBuilder:
        _ = bag_path
        return self._builder


class ExplodingFactory:
    def create_bag_extractor(self, bag_path: str) -> ExplodingExtractor:
        _ = bag_path
        return ExplodingExtractor()

    def create_bag_index_builder(self, bag_path: str) -> ExplodingBagIndexBuilder:
        _ = bag_path
        return ExplodingBagIndexBuilder()


class FakeSearch:
    """Fake for either GlobalSearch or DenseSearch — records invalidate calls."""

    def __init__(self) -> None:
        self.invalidated: list[BagArtifacts] = []

    def invalidate(self, artifacts: BagArtifacts) -> None:
        self.invalidated.append(artifacts)


# ---------------------------------------------------------------------------
# Tests: error / manifest-delete path
# ---------------------------------------------------------------------------


def test_index_bag_delete_at_start_clears_manifest_on_failure(tmp_path: Path) -> None:
    bag_dir = tmp_path / "broken_bag"
    bag_dir.mkdir()
    # A stale manifest from a prior successful run.
    artifact = artifacts_for_bag(bag_dir).dir
    IndexManifest(
        embedder=EmbedderStamp(name="old", dim=4), frame_count=5, cameras=["/c"], region_index=False,
    ).write(BagArtifacts(artifact))
    assert IndexManifest.is_indexed(BagArtifacts(artifact)) is True

    service = IndexingService(
        factory=ExplodingFactory(),  # type: ignore[arg-type]
        status_store={},
        error_store={},
    )
    # Extractor explodes before build() ever runs.
    service.index_bag(str(bag_dir))

    assert IndexManifest.is_indexed(BagArtifacts(artifact)) is False


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


# ---------------------------------------------------------------------------
# Tests: happy path — builder + facade invalidation
# ---------------------------------------------------------------------------


def test_index_bag_calls_build_and_invalidates_facades(tmp_path: Path) -> None:
    bag_dir = tmp_path / "good_bag"
    bag_dir.mkdir()

    builder = FakeBagIndexBuilder()
    global_search = FakeSearch()
    dense_search = FakeSearch()
    status_store: dict[str, str] = {}

    service = IndexingService(
        factory=FakeFactory(builder),  # type: ignore[arg-type]
        status_store=status_store,
        global_search=global_search,  # type: ignore[arg-type]
        dense_search=dense_search,  # type: ignore[arg-type]
    )

    service.index_bag(str(bag_dir))

    resolved = str(bag_dir.resolve())
    expected_artifacts = artifacts_for_bag(Path(resolved))

    assert builder.built is True, "BagIndexBuilder.build() was not called"
    assert status_store[resolved] == "done"

    assert len(global_search.invalidated) == 1
    assert global_search.invalidated[0].dir == expected_artifacts.dir

    assert len(dense_search.invalidated) == 1
    assert dense_search.invalidated[0].dir == expected_artifacts.dir


def test_index_bag_skips_invalidation_when_facades_are_none(tmp_path: Path) -> None:
    bag_dir = tmp_path / "good_bag"
    bag_dir.mkdir()

    builder = FakeBagIndexBuilder()
    status_store: dict[str, str] = {}

    service = IndexingService(
        factory=FakeFactory(builder),  # type: ignore[arg-type]
        status_store=status_store,
    )

    # Must not raise even when both facades are None.
    service.index_bag(str(bag_dir))

    resolved = str(bag_dir.resolve())
    assert status_store[resolved] == "done"
    assert builder.built is True
