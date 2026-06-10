import json

from src.geo.area import Circle
from src.geo.locator import LocatedFrame, frames_in_area, resolve_area_to_frames
from src.core.app_config import get_app_config
from src.core.storage import resolve_artifact_path


def _frame(ts, topic, fp, lat=None, lon=None):
    f = {"timestamp_ns": ts, "topic": topic, "file_path": fp}
    if lat is not None:
        f["lat"], f["lon"] = lat, lon
    return f


def test_frames_in_area_keeps_only_located_inside():
    frames = [
        _frame(1, "/c", "a.jpg", 45.0, 10.0),           # inside
        _frame(2, "/c", "b.jpg", 45.5, 10.5),           # outside
        _frame(3, "/c", "c.jpg"),                       # unlocated → excluded
    ]
    area = Circle(lat=45.0, lon=10.0, radius_m=200.0)
    assert frames_in_area(area, frames) == [0]


def test_resolve_area_to_frames_per_bag_and_frame_id(tmp_path, monkeypatch):
    monkeypatch.setattr("src.core.app_config.get_app_config", get_app_config)
    cfg = get_app_config()
    bag = tmp_path / "bag1"
    artifact = resolve_artifact_path(bag_path=bag)
    artifact.mkdir(parents=True)
    meta = {"schema_version": 5, "frames": [
        _frame(10, "/c", "thumbnails/c/f10.jpg", 45.0, 10.0),  # frame_id 0, inside
        _frame(20, "/c", "thumbnails/c/f20.jpg", 48.0, 12.0),  # frame_id 1, outside
    ]}
    (artifact / "metadata.json").write_text(json.dumps(meta))

    area = Circle(lat=45.0, lon=10.0, radius_m=300.0)
    out = resolve_area_to_frames(area, [str(bag)])
    located = out[str(bag)]
    assert len(located) == 1
    # file_path is ABSOLUTE — it must match the LanceDB `file_path` column (Global
    # compose IN-list) and be directly fetchable via /api/image (browse previews).
    assert located[0] == LocatedFrame(
        frame_id=0, file_path=str(artifact / "thumbnails/c/f10.jpg"), topic="/c",
        timestamp_ns=10, lat=45.0, lon=10.0,
    )


def test_resolve_skips_bag_without_metadata(tmp_path):
    out = resolve_area_to_frames(Circle(45.0, 10.0, 100.0), [str(tmp_path / "nope")])
    assert out == {str(tmp_path / "nope"): []}
