"""Unit tests for src/services/result_format.py::to_response.

Covers the two highest-risk derived fields:
- file_path: absolute path constructed from artifacts.dir + frame.file_path (relative)
- bag_path: resolved original .mcap path, NOT the artifact directory

Also covers the conditional lat/lon branch.
"""

from pathlib import Path

import pytest

from data_extraction_lib.artifacts import BagArtifacts, MetadataFrameEntry
from data_extraction_lib.geo import Coordinate
from data_extraction_lib.index import SearchResult

from src.services.result_format import to_response


ARTIFACT_DIR = Path("/bags/mybag/.bag_chat")
ORIGINAL_BAG_PATH = "/bags/mybag.mcap"
RELATIVE_FRAME_PATH = "thumbnails/cam_a/f.jpg"


def _make_artifacts() -> BagArtifacts:
    return BagArtifacts(ARTIFACT_DIR)


def _make_frame(*, coordinate: Coordinate | None) -> MetadataFrameEntry:
    return MetadataFrameEntry(
        timestamp_ns=123_456_789,
        topic="/cam/front",
        file_path=RELATIVE_FRAME_PATH,
        coordinate=coordinate,
    )


def _make_result(frame: MetadataFrameEntry) -> SearchResult:
    return SearchResult(
        artifacts=_make_artifacts(),
        frame=frame,
        score=0.87,
    )


def _bag_path_by_dir(artifacts: BagArtifacts) -> dict[str, str]:
    return {str(artifacts.dir): ORIGINAL_BAG_PATH}


# ---------------------------------------------------------------------------
# Core scalar fields
# ---------------------------------------------------------------------------


def test_timestamp_ns_and_topic_pass_through():
    artifacts = _make_artifacts()
    frame = _make_frame(coordinate=None)
    rows = to_response([_make_result(frame)], _bag_path_by_dir(artifacts))
    assert rows[0]["timestamp_ns"] == 123_456_789
    assert rows[0]["topic"] == "/cam/front"


def test_similarity_score_passes_through():
    artifacts = _make_artifacts()
    frame = _make_frame(coordinate=None)
    rows = to_response([_make_result(frame)], _bag_path_by_dir(artifacts))
    assert rows[0]["similarity_score"] == pytest.approx(0.87)


# ---------------------------------------------------------------------------
# file_path: must be absolute, joined from artifacts.dir + relative frame path
# ---------------------------------------------------------------------------


def test_file_path_is_absolute_join_of_artifact_dir_and_relative_frame_path():
    artifacts = _make_artifacts()
    frame = _make_frame(coordinate=None)
    rows = to_response([_make_result(frame)], _bag_path_by_dir(artifacts))
    expected = str(ARTIFACT_DIR / RELATIVE_FRAME_PATH)
    assert rows[0]["file_path"] == expected


def test_file_path_is_not_the_original_bag_path():
    artifacts = _make_artifacts()
    frame = _make_frame(coordinate=None)
    rows = to_response([_make_result(frame)], _bag_path_by_dir(artifacts))
    assert ORIGINAL_BAG_PATH not in rows[0]["file_path"]


# ---------------------------------------------------------------------------
# bag_path: must be the RESOLVED original .mcap path, NOT artifacts.dir
# ---------------------------------------------------------------------------


def test_bag_path_is_resolved_original_mcap_path():
    artifacts = _make_artifacts()
    frame = _make_frame(coordinate=None)
    rows = to_response([_make_result(frame)], _bag_path_by_dir(artifacts))
    expected = str(Path(ORIGINAL_BAG_PATH).resolve())
    assert rows[0]["bag_path"] == expected


def test_bag_path_does_not_contain_artifact_dir():
    artifacts = _make_artifacts()
    frame = _make_frame(coordinate=None)
    rows = to_response([_make_result(frame)], _bag_path_by_dir(artifacts))
    assert ".bag_chat" not in rows[0]["bag_path"]


def test_source_bag_is_mcap_basename():
    artifacts = _make_artifacts()
    frame = _make_frame(coordinate=None)
    rows = to_response([_make_result(frame)], _bag_path_by_dir(artifacts))
    assert rows[0]["source_bag"] == "mybag.mcap"


# ---------------------------------------------------------------------------
# Coordinate branch: present when coordinate is set, absent when None
# ---------------------------------------------------------------------------


def test_lat_lon_present_when_coordinate_set():
    artifacts = _make_artifacts()
    frame = _make_frame(coordinate=Coordinate(48.0, 11.0))
    rows = to_response([_make_result(frame)], _bag_path_by_dir(artifacts))
    assert rows[0]["lat"] == pytest.approx(48.0)
    assert rows[0]["lon"] == pytest.approx(11.0)


def test_lat_lon_absent_when_coordinate_is_none():
    artifacts = _make_artifacts()
    frame = _make_frame(coordinate=None)
    rows = to_response([_make_result(frame)], _bag_path_by_dir(artifacts))
    assert "lat" not in rows[0]
    assert "lon" not in rows[0]


# ---------------------------------------------------------------------------
# Multiple results preserve order
# ---------------------------------------------------------------------------


def test_multiple_results_preserve_order():
    artifacts = _make_artifacts()
    frame_a = MetadataFrameEntry(
        timestamp_ns=1_000, topic="/cam/a", file_path="a.jpg", coordinate=None
    )
    frame_b = MetadataFrameEntry(
        timestamp_ns=2_000, topic="/cam/b", file_path="b.jpg", coordinate=None
    )
    results = [
        SearchResult(artifacts=artifacts, frame=frame_a, score=0.9),
        SearchResult(artifacts=artifacts, frame=frame_b, score=0.7),
    ]
    rows = to_response(results, _bag_path_by_dir(artifacts))
    assert len(rows) == 2
    assert rows[0]["timestamp_ns"] == 1_000
    assert rows[1]["timestamp_ns"] == 2_000


def test_empty_results_returns_empty_list():
    rows = to_response([], {})
    assert rows == []
