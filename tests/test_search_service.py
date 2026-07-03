"""Unit tests for src/services/search_service.py::SearchService.

Tests the delegation contract: correct response-dict fields (bag_path, file_path,
source_bag, similarity_score, timestamp_ns, topic) and that the fake GlobalSearch
receives a BagArtifacts list and the window_ns derived from config.
"""

from __future__ import annotations

import dataclasses
from pathlib import Path
from unittest.mock import patch

import pytest

from data_extraction_lib.artifacts import BagArtifacts, MetadataFrameEntry
from data_extraction_lib.geo import Coordinate
from data_extraction_lib.index import SearchResult

from chat2bag.core.app_config import AppConfig, SearchConfig, get_app_config
from chat2bag.services.search_service import SearchService


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

BAG_PATH = "/bags/mybag.mcap"
ARTIFACT_DIR = Path("/bags/mybag/.bag_chat")
RELATIVE_FRAME = "thumbnails/cam_a/frame0001.jpg"


def _make_artifacts() -> BagArtifacts:
    return BagArtifacts(ARTIFACT_DIR)


def _make_frame(*, with_coord: bool = False) -> MetadataFrameEntry:
    coord = Coordinate(48.0, 11.0) if with_coord else None
    return MetadataFrameEntry(
        timestamp_ns=500_000_000,
        topic="/cam/front",
        file_path=RELATIVE_FRAME,
        coordinate=coord,
    )


def _make_result(frame: MetadataFrameEntry) -> SearchResult:
    return SearchResult(
        artifacts=_make_artifacts(),
        frame=frame,
        score=0.75,
    )


def _config_with_window(window_sec: float) -> AppConfig:
    base = get_app_config()
    return dataclasses.replace(
        base,
        search=dataclasses.replace(base.search, temporal_dedup_window_sec=window_sec),
    )


# ---------------------------------------------------------------------------
# Fake GlobalSearch
# ---------------------------------------------------------------------------


class FakeGlobalSearch:
    """Minimal fake that records call args and returns a fixed result list."""

    def __init__(self, results: list[SearchResult]) -> None:
        self._results = results
        self.received_query: str | None = None
        self.received_bags: list[BagArtifacts] | None = None
        self.received_top_k: int | None = None
        self.received_window_ns: int | None = None
        self.received_area = None

    def search_text(self, query, bags, *, top_k, window_ns, area=None):
        self.received_query = query
        self.received_bags = bags
        self.received_top_k = top_k
        self.received_window_ns = window_ns
        self.received_area = area
        return self._results


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_search_response_contains_correct_bag_path():
    """bag_path must be the resolved ORIGINAL .mcap path, not the artifact dir."""
    frame = _make_frame()
    fake = FakeGlobalSearch([_make_result(frame)])
    svc = SearchService(fake, _config_with_window(20.0))

    with patch("chat2bag.services.search_service.artifacts_for_bag", return_value=_make_artifacts()):
        rows = svc.search("car", [BAG_PATH], top_k=5)

    assert len(rows) == 1
    assert rows[0]["bag_path"] == str(Path(BAG_PATH).resolve())


def test_search_response_contains_correct_file_path():
    """file_path must be absolute: artifacts.dir joined with the relative frame path."""
    frame = _make_frame()
    fake = FakeGlobalSearch([_make_result(frame)])
    svc = SearchService(fake, _config_with_window(20.0))

    with patch("chat2bag.services.search_service.artifacts_for_bag", return_value=_make_artifacts()):
        rows = svc.search("car", [BAG_PATH], top_k=5)

    expected = str(ARTIFACT_DIR / RELATIVE_FRAME)
    assert rows[0]["file_path"] == expected


def test_search_response_contains_source_bag_basename():
    frame = _make_frame()
    fake = FakeGlobalSearch([_make_result(frame)])
    svc = SearchService(fake, _config_with_window(20.0))

    with patch("chat2bag.services.search_service.artifacts_for_bag", return_value=_make_artifacts()):
        rows = svc.search("car", [BAG_PATH], top_k=5)

    assert rows[0]["source_bag"] == "mybag.mcap"


def test_search_response_contains_scalar_fields():
    frame = _make_frame()
    fake = FakeGlobalSearch([_make_result(frame)])
    svc = SearchService(fake, _config_with_window(20.0))

    with patch("chat2bag.services.search_service.artifacts_for_bag", return_value=_make_artifacts()):
        rows = svc.search("car", [BAG_PATH], top_k=5)

    row = rows[0]
    assert row["timestamp_ns"] == 500_000_000
    assert row["topic"] == "/cam/front"
    assert row["similarity_score"] == pytest.approx(0.75)


def test_search_includes_lat_lon_when_coordinate_present():
    frame = _make_frame(with_coord=True)
    fake = FakeGlobalSearch([_make_result(frame)])
    svc = SearchService(fake, _config_with_window(20.0))

    with patch("chat2bag.services.search_service.artifacts_for_bag", return_value=_make_artifacts()):
        rows = svc.search("car", [BAG_PATH], top_k=5)

    assert rows[0]["lat"] == pytest.approx(48.0)
    assert rows[0]["lon"] == pytest.approx(11.0)


def test_search_excludes_lat_lon_when_no_coordinate():
    frame = _make_frame(with_coord=False)
    fake = FakeGlobalSearch([_make_result(frame)])
    svc = SearchService(fake, _config_with_window(20.0))

    with patch("chat2bag.services.search_service.artifacts_for_bag", return_value=_make_artifacts()):
        rows = svc.search("car", [BAG_PATH], top_k=5)

    assert "lat" not in rows[0]
    assert "lon" not in rows[0]


def test_search_delegates_window_ns_from_config():
    """window_ns passed to the fake must match config.search.temporal_dedup_window_sec * 1e9."""
    frame = _make_frame()
    fake = FakeGlobalSearch([_make_result(frame)])
    svc = SearchService(fake, _config_with_window(15.0))

    with patch("chat2bag.services.search_service.artifacts_for_bag", return_value=_make_artifacts()):
        svc.search("car", [BAG_PATH], top_k=5)

    assert fake.received_window_ns == 15_000_000_000


def test_search_delegates_artifacts_list_to_fake():
    """The fake must receive a BagArtifacts whose dir matches the patched return value."""
    frame = _make_frame()
    fake = FakeGlobalSearch([_make_result(frame)])
    expected_artifacts = _make_artifacts()
    svc = SearchService(fake, _config_with_window(20.0))

    with patch("chat2bag.services.search_service.artifacts_for_bag", return_value=expected_artifacts):
        svc.search("car", [BAG_PATH], top_k=5)

    assert len(fake.received_bags) == 1
    assert fake.received_bags[0].dir == expected_artifacts.dir


def test_search_raises_when_no_bag_paths():
    fake = FakeGlobalSearch([])
    svc = SearchService(fake, get_app_config())

    with pytest.raises(ValueError, match="at least one"):
        svc.search("car", [], top_k=5)
