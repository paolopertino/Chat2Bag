"""Area types + point-in-area tests for Map search (no spatial index)."""
import math
from dataclasses import dataclass

_EARTH_RADIUS_M = 6_371_000.0


@dataclass(frozen=True)
class Circle:
    lat: float
    lon: float
    radius_m: float


@dataclass(frozen=True)
class Polygon:
    vertices: tuple[tuple[float, float], ...]  # (lat, lon), >= 3


Area = Circle | Polygon


def haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in metres between two WGS84 points."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * _EARTH_RADIUS_M * math.asin(math.sqrt(a))


def bbox(area: "Area") -> tuple[float, float, float, float]:
    """(min_lat, min_lon, max_lat, max_lon) coarse bounding box."""
    if isinstance(area, Circle):
        dlat = area.radius_m / 111_320.0
        coslat = max(math.cos(math.radians(area.lat)), 1e-6)
        dlon = area.radius_m / (111_320.0 * coslat)
        return (area.lat - dlat, area.lon - dlon, area.lat + dlat, area.lon + dlon)
    lats = [v[0] for v in area.vertices]
    lons = [v[1] for v in area.vertices]
    return (min(lats), min(lons), max(lats), max(lons))


def _point_in_polygon(lat: float, lon: float, vertices) -> bool:
    """Ray casting on (x=lon, y=lat)."""
    inside = False
    n = len(vertices)
    j = n - 1
    for i in range(n):
        yi, xi = vertices[i]
        yj, xj = vertices[j]
        if (yi > lat) != (yj > lat):
            x_cross = (xj - xi) * (lat - yi) / (yj - yi) + xi
            if lon < x_cross:
                inside = not inside
        j = i
    return inside


def contains(area: "Area", lat: float, lon: float) -> bool:
    """bbox prefilter, then exact circle/polygon test."""
    min_lat, min_lon, max_lat, max_lon = bbox(area)
    if not (min_lat <= lat <= max_lat and min_lon <= lon <= max_lon):
        return False
    if isinstance(area, Circle):
        return haversine(area.lat, area.lon, lat, lon) <= area.radius_m
    return _point_in_polygon(lat, lon, area.vertices)


def area_from_payload(payload: dict | None) -> "Area | None":
    """Parse the API `area` object (spec §5.1) into an Area dataclass."""
    if payload is None:
        return None
    kind = payload.get("kind")
    if kind == "circle":
        c = payload["center"]
        return Circle(lat=float(c["lat"]), lon=float(c["lon"]), radius_m=float(payload["radius_m"]))
    if kind == "polygon":
        verts = tuple((float(v["lat"]), float(v["lon"])) for v in payload["vertices"])
        return Polygon(vertices=verts)
    raise ValueError(f"Unknown area kind: {kind!r}")
