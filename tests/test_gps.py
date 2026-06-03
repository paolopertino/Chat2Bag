import math
from types import SimpleNamespace

from src.ingestion.gps import Fix, fix_from_navsatfix, locate_frames


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
