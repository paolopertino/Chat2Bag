import pytest

from data_extraction_lib.artifacts import Metadata
from data_extraction_lib.ros2.records import (
    ExtractionResult,
    FrameRecord,
    LocatedFrame,
    TimestampedCoordinate,
)

from src.core.app_config import get_app_config
from src.ingestion.extraction import result_to_metadata


def _config():
    return get_app_config()


def _located(ts, topic, coord=None):
    return LocatedFrame(frame=FrameRecord(timestamp_ns=ts, topic=topic, file_path=f"thumbnails/c/frame_{ts}.jpg"), coordinate=coord)


def test_metadata_flattens_coordinate_into_frame_dicts():
    cfg = _config()
    cam = cfg.ingestion.camera_topics[0]
    gps = cfg.ingestion.gps_topic
    result = ExtractionResult(
        present_topics=[cam, gps] if gps else [cam],
        located_frames=[
            _located(1, cam, TimestampedCoordinate(1, 45.0, 10.0)),
            _located(2, cam, None),
        ],
        coordinates=[TimestampedCoordinate(1, 45.0, 10.0)],
    )
    meta = result_to_metadata(result, bag_name="bag", config=cfg)
    assert meta.schema_version == Metadata.SCHEMA_VERSION  # == 5
    assert meta.cameras == [cam]
    assert meta.frames[0]["lat"] == 45.0 and meta.frames[0]["lon"] == 10.0
    assert "lat" not in meta.frames[1] and "lon" not in meta.frames[1]


def test_gps_stamp_present_but_empty_yields_zero_counts_not_none():
    cfg = _config()
    cam, gps = cfg.ingestion.camera_topics[0], cfg.ingestion.gps_topic
    if not gps:
        pytest.skip("config has no gps_topic")
    result = ExtractionResult(present_topics=[cam, gps], located_frames=[_located(1, cam, None)], coordinates=[])
    meta = result_to_metadata(result, bag_name="bag", config=cfg)
    assert meta.gps is not None
    assert meta.gps.fix_count == 0 and meta.gps.located_frame_count == 0 and meta.gps.frame_count == 1


def test_gps_stamp_none_when_topic_absent_from_bag():
    cfg = _config()
    cam = cfg.ingestion.camera_topics[0]
    result = ExtractionResult(present_topics=[cam], located_frames=[_located(1, cam, None)], coordinates=[])
    meta = result_to_metadata(result, bag_name="bag", config=cfg)
    assert meta.gps is None


def test_no_camera_topics_present_raises():
    cfg = _config()
    result = ExtractionResult(present_topics=[], located_frames=[], coordinates=[])
    with pytest.raises(ValueError):
        result_to_metadata(result, bag_name="bag", config=cfg)
