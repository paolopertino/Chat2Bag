import json

from data_extraction_lib.geo import Area, Circle, Coordinate

from src.core.storage import artifacts_for_bag
from src.geo.area_payload import parse_area_payload
from src.geo.locator import LocatedFrame, frames_in_area, resolve_area_to_frames


def _frame(ts, topic, fp, lat=None, lon=None):
    f = {"timestamp_ns": ts, "topic": topic, "file_path": fp}
    if lat is not None:
        f["lat"], f["lon"] = lat, lon
    return f


def _circle(lat, lon, r):
    # Exercises the app-side bridge: a legacy single-shape payload -> lib Area.
    return parse_area_payload({"kind": "circle", "center": {"lat": lat, "lon": lon}, "radius_m": r})


def test_parse_area_payload_wraps_single_shape_passes_generic_and_none():
    assert parse_area_payload(None) is None
    wrapped = parse_area_payload(
        {"kind": "circle", "center": {"lat": 45.0, "lon": 10.0}, "radius_m": 50}
    )
    assert wrapped == Area(geometries=(Circle(center=Coordinate(45.0, 10.0), radius_m=50.0),))
    # An already-generic payload passes straight through.
    generic = parse_area_payload(
        {"geometries": [{"kind": "circle", "center": {"lat": 1.0, "lon": 2.0}, "radius_m": 3}]}
    )
    assert generic == Area(geometries=(Circle(center=Coordinate(1.0, 2.0), radius_m=3.0),))


def test_frames_in_area_keeps_only_located_inside():
    frames = [
        _frame(1, "/c", "a.jpg", 45.0, 10.0),  # inside
        _frame(2, "/c", "b.jpg", 45.5, 10.5),  # outside
        _frame(3, "/c", "c.jpg"),              # unlocated -> excluded
    ]
    assert frames_in_area(_circle(45.0, 10.0, 200.0), frames) == [0]


def test_resolve_area_to_frames_per_bag_and_frame_id(tmp_path):
    bag = tmp_path / "bag1"
    artifact = artifacts_for_bag(bag).dir
    artifact.mkdir(parents=True)
    meta = {"schema_version": 5, "frames": [
        _frame(10, "/c", "thumbnails/c/f10.jpg", 45.0, 10.0),  # frame_id 0, inside
        _frame(20, "/c", "thumbnails/c/f20.jpg", 48.0, 12.0),  # frame_id 1, outside
    ]}
    (artifact / "metadata.json").write_text(json.dumps(meta))

    out = resolve_area_to_frames(_circle(45.0, 10.0, 300.0), [str(bag)])
    located = out[str(bag)]
    assert len(located) == 1
    # file_path is ABSOLUTE -- must match the LanceDB `file_path` column and /api/image.
    assert located[0] == LocatedFrame(
        frame_id=0, file_path=str(artifact / "thumbnails/c/f10.jpg"), topic="/c",
        timestamp_ns=10, lat=45.0, lon=10.0,
    )


def test_resolve_skips_bag_without_metadata(tmp_path):
    out = resolve_area_to_frames(_circle(45.0, 10.0, 100.0), [str(tmp_path / "nope")])
    assert out == {str(tmp_path / "nope"): []}
