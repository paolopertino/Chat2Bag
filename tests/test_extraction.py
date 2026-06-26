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


def test_bag_extractor_end_to_end_writes_metadata(tmp_path, monkeypatch):
    import json
    from types import SimpleNamespace

    import numpy as np

    import dataclasses

    import data_extraction_lib.ros2.reader as reader_mod
    import data_extraction_lib.ros2.convert as convert_mod
    import data_extraction_lib.ros2.sink as sink_mod
    from src.ingestion.extraction import BagExtractor

    base = get_app_config()
    cam = base.ingestion.camera_topics[0]
    gps = base.ingestion.gps_topic or "/oxts/nav_sat_fix"
    # IngestionConfig/AppConfig are frozen; rebuild with a guaranteed gps_topic.
    cfg = dataclasses.replace(base, ingestion=dataclasses.replace(base.ingestion, gps_topic=gps))

    navsat = SimpleNamespace(latitude=45.88, longitude=10.19, status=SimpleNamespace(status=2, service=0))

    class _Conn:
        def __init__(self, topic, msgtype):
            self.topic, self.msgtype = topic, msgtype

    class _RosbagsReader:
        connections = [_Conn(gps, "sensor_msgs/msg/NavSatFix"), _Conn(cam, "sensor_msgs/msg/CompressedImage")]

        def __init__(self, path):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def messages(self, connections=None):
            wanted = {c.topic for c in connections}
            data = [
                (gps, "sensor_msgs/msg/NavSatFix", 1_000_000_000, navsat),
                (cam, "sensor_msgs/msg/CompressedImage", 1_050_000_000, object()),
            ]
            for topic, mt, ts, msg in data:
                if topic in wanted:
                    yield _Conn(topic, mt), ts, msg

    monkeypatch.setattr(reader_mod, "Reader", _RosbagsReader)
    monkeypatch.setattr(reader_mod, "get_typestore", lambda store: SimpleNamespace(deserialize_cdr=lambda raw, mt: raw))
    monkeypatch.setattr(convert_mod, "message_to_cvimage", lambda msg, enc: np.zeros((8, 8, 3), np.uint8))
    monkeypatch.setattr(sink_mod.cv2, "imwrite", lambda path, img: True)

    bag = tmp_path / "mybag"
    bag.mkdir()
    meta_path = BagExtractor(str(bag), config=cfg).extract()
    meta = json.loads(meta_path.read_text())

    assert meta["schema_version"] == 5
    assert len(meta["frames"]) == 1
    assert meta["frames"][0]["lat"] == 45.88 and meta["frames"][0]["lon"] == 10.19
    assert meta["gps"]["topic"] == gps and meta["gps"]["fix_count"] == 1
    assert meta["gps"]["located_frame_count"] == 1 and meta["gps"]["frame_count"] == 1
