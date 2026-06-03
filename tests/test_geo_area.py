import math

import pytest

from src.geo.area import Circle, Polygon, area_from_payload, contains, haversine


def test_haversine_known_distance():
    # ~111.19 km per degree of latitude at the equator
    d = haversine(0.0, 0.0, 1.0, 0.0)
    assert abs(d - 111195) < 500


def test_circle_contains_boundary():
    c = Circle(lat=45.0, lon=10.0, radius_m=150.0)
    assert contains(c, 45.0, 10.0) is True
    inside_lat = 45.0 + (100.0 / 111195.0)   # ~100 m north
    outside_lat = 45.0 + (300.0 / 111195.0)  # ~300 m north
    assert contains(c, inside_lat, 10.0) is True
    assert contains(c, outside_lat, 10.0) is False


def test_polygon_contains_and_outside():
    sq = Polygon(vertices=((0.0, 0.0), (0.0, 2.0), (2.0, 2.0), (2.0, 0.0)))
    assert contains(sq, 1.0, 1.0) is True
    assert contains(sq, 3.0, 3.0) is False
    assert contains(sq, 1.0, 5.0) is False  # outside bbox fast-path


def test_area_from_payload_circle_and_polygon():
    c = area_from_payload({"kind": "circle", "center": {"lat": 45.0, "lon": 10.0}, "radius_m": 120})
    assert c == Circle(lat=45.0, lon=10.0, radius_m=120.0)
    p = area_from_payload({"kind": "polygon", "vertices": [
        {"lat": 0.0, "lon": 0.0}, {"lat": 0.0, "lon": 1.0}, {"lat": 1.0, "lon": 1.0}]})
    assert p == Polygon(vertices=((0.0, 0.0), (0.0, 1.0), (1.0, 1.0)))


def test_area_from_payload_none_and_bad():
    assert area_from_payload(None) is None
    with pytest.raises(ValueError):
        area_from_payload({"kind": "blob"})
