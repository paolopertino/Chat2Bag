import json
from types import SimpleNamespace

import numpy as np
import pytest

import src.ingestion.bag_parser as bp
from src.core.app_config import get_app_config


def _navsatfix(lat, lon, status=2):
    return SimpleNamespace(latitude=lat, longitude=lon, status=SimpleNamespace(status=status, service=0))


class _Conn:
    def __init__(self, topic, msgtype):
        self.topic, self.msgtype = topic, msgtype


class _Reader:
    def __init__(self, messages):
        self._messages = messages
        self.connections = [_Conn(t, mt) for (t, mt, _, _) in messages]

    def __enter__(self): return self
    def __exit__(self, *a): return False

    def messages(self, connections=None):
        wanted = {c.topic for c in connections} if connections is not None else None
        for topic, msgtype, ts, msg in self._messages:
            if wanted is None or topic in wanted:
                yield _Conn(topic, msgtype), ts, msg


def test_extract_frames_attaches_locations_and_gps_stamp(tmp_path, monkeypatch):
    cam = "/lucid_vision/lucid_cam_front_center/image_rect/compressed"
    gps = "/oxts/nav_sat_fix"
    cam_msg, gps_msg = object(), _navsatfix(45.88, 10.19)
    messages = [
        (gps, "sensor_msgs/msg/NavSatFix", 1_000_000_000, gps_msg),       # near frame
        (cam, "sensor_msgs/msg/CompressedImage", 1_050_000_000, cam_msg), # 0.05s from fix
    ]

    monkeypatch.setattr(bp, "Reader", lambda path: _Reader(messages))
    monkeypatch.setattr(bp, "get_typestore", lambda store: SimpleNamespace(
        deserialize_cdr=lambda raw, mt: raw))
    monkeypatch.setattr(bp, "message_to_cvimage", lambda msg, enc: np.zeros((8, 8, 3), np.uint8))
    monkeypatch.setattr(bp.cv2, "imwrite", lambda path, img: True)

    bag = tmp_path / "mybag"
    bag.mkdir()
    parser = bp.BagParser(str(bag), config=get_app_config())
    meta_path = parser.extract_frames()

    meta = json.loads(meta_path.read_text())
    assert meta["schema_version"] == 5
    assert len(meta["frames"]) == 1
    assert meta["frames"][0]["lat"] == 45.88 and meta["frames"][0]["lon"] == 10.19
    assert meta["gps"]["topic"] == gps
    assert meta["gps"]["fix_count"] == 1
    assert meta["gps"]["located_frame_count"] == 1
    assert meta["gps"]["frame_count"] == 1


def test_extract_frames_gps_null_when_topic_absent(tmp_path, monkeypatch):
    cam = "/lucid_vision/lucid_cam_front_center/image_rect/compressed"
    messages = [(cam, "sensor_msgs/msg/CompressedImage", 1_000_000_000, object())]
    monkeypatch.setattr(bp, "Reader", lambda path: _Reader(messages))
    monkeypatch.setattr(bp, "get_typestore", lambda store: SimpleNamespace(deserialize_cdr=lambda raw, mt: raw))
    monkeypatch.setattr(bp, "message_to_cvimage", lambda msg, enc: __import__("numpy").zeros((8, 8, 3), __import__("numpy").uint8))
    monkeypatch.setattr(bp.cv2, "imwrite", lambda path, img: True)

    bag = tmp_path / "nogps"
    bag.mkdir()
    meta_path = bp.BagParser(str(bag), config=get_app_config()).extract_frames()
    meta = json.loads(meta_path.read_text())
    assert meta["gps"] is None
    assert "lat" not in meta["frames"][0]
