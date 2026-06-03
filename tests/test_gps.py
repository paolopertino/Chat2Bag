import math
from types import SimpleNamespace

from src.ingestion.gps import Fix, fix_from_navsatfix, locate_frames, read_fixes


class _FakeConnection:
    def __init__(self, topic, msgtype):
        self.topic = topic
        self.msgtype = msgtype


class _FakeReader:
    """Minimal rosbags-Reader stand-in: .connections + .messages(connections=...)."""

    def __init__(self, messages):
        # messages: list of (topic, msgtype, timestamp_ns, deserialized_msg)
        self._messages = messages
        self.connections = [_FakeConnection(t, mt) for (t, mt, _, _) in messages]

    def messages(self, connections=None):
        wanted = {c.topic for c in connections} if connections is not None else None
        for topic, msgtype, ts, msg in self._messages:
            if wanted is None or topic in wanted:
                yield _FakeConnection(topic, msgtype), ts, msg


class _FakeTypestore:
    def __init__(self, by_raw):
        self._by_raw = by_raw  # maps the placeholder rawdata back to a msg

    def deserialize_cdr(self, rawdata, msgtype):
        return self._by_raw[rawdata]


def _navsatfix(lat, lon, status=2):
    # mirrors sensor_msgs/msg/NavSatFix: .latitude, .longitude, .status.status
    return SimpleNamespace(latitude=lat, longitude=lon, status=SimpleNamespace(status=status, service=0))


def test_valid_fix_parsed():
    fix = fix_from_navsatfix(_navsatfix(45.5, 10.2), timestamp_ns=1000)
    assert fix == Fix(timestamp_ns=1000, lat=45.5, lon=10.2)


def test_no_fix_status_dropped():
    assert fix_from_navsatfix(_navsatfix(45.5, 10.2, status=-1), timestamp_ns=1000) is None


def test_nan_coords_dropped():
    assert fix_from_navsatfix(_navsatfix(math.nan, 10.2), timestamp_ns=1) is None
    assert fix_from_navsatfix(_navsatfix(45.5, math.nan), timestamp_ns=1) is None


def test_locate_assigns_nearest_within_tolerance():
    frames = [
        {"timestamp_ns": 1_000_000_000, "topic": "/c", "file_path": "a.jpg"},
        {"timestamp_ns": 5_000_000_000, "topic": "/c", "file_path": "b.jpg"},
    ]
    fixes = [
        Fix(timestamp_ns=1_100_000_000, lat=45.0, lon=10.0),  # 0.1s from frame 0
        Fix(timestamp_ns=4_000_000_000, lat=46.0, lon=11.0),  # 1.0s from frame 1
    ]
    located = locate_frames(frames, fixes, max_gap_ns=1_000_000_000)
    assert located == 2
    assert frames[0]["lat"] == 45.0 and frames[0]["lon"] == 10.0
    assert frames[1]["lat"] == 46.0 and frames[1]["lon"] == 11.0


def test_locate_drops_frame_in_gps_dropout():
    frames = [{"timestamp_ns": 10_000_000_000, "topic": "/c", "file_path": "a.jpg"}]
    fixes = [Fix(timestamp_ns=1_000_000_000, lat=45.0, lon=10.0)]  # 9s away
    located = locate_frames(frames, fixes, max_gap_ns=1_000_000_000)
    assert located == 0
    assert "lat" not in frames[0] and "lon" not in frames[0]


def test_locate_no_fixes_is_noop():
    frames = [{"timestamp_ns": 1, "topic": "/c", "file_path": "a.jpg"}]
    assert locate_frames(frames, [], max_gap_ns=1_000_000_000) == 0
    assert "lat" not in frames[0]


def test_read_fixes_filters_to_topic_and_validity():
    good = _navsatfix(45.0, 10.0, status=2)
    bad = _navsatfix(45.0, 10.0, status=-1)
    msgs = [
        ("/oxts/nav_sat_fix", "sensor_msgs/msg/NavSatFix", 100, "RAW_GOOD"),
        ("/cam", "sensor_msgs/msg/Image", 150, "RAW_IMG"),
        ("/oxts/nav_sat_fix", "sensor_msgs/msg/NavSatFix", 200, "RAW_BAD"),
    ]
    reader = _FakeReader(msgs)
    ts = _FakeTypestore({"RAW_GOOD": good, "RAW_BAD": bad, "RAW_IMG": object()})
    fixes = read_fixes(reader, "/oxts/nav_sat_fix", ts)
    assert fixes == [Fix(timestamp_ns=100, lat=45.0, lon=10.0)]
