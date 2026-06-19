# Geo Migration to data-extraction-lib — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Chat2Bag's `geo` capability (area geometry + frame-in-area location) into `data-extraction-lib`, remodelled as objects (`Coordinate`/`Geometry`/`Area`), and rewire the webapp onto it with identical behavior.

**Architecture:** The library gets a ROS-agnostic `geo` package: a `Geometry` ABC (`Circle`/`Polygon`) with polymorphic `.contains`/`.bbox`, an `Area` that composes 1..n geometries (union `.contains`), `haversine`, and a pure `locator` (`LocatedFrame`, `frames_in_area`, `located_frames_in_area`). The webapp imports these from the lib; the only piece that stays in the webapp is `resolve_area_to_frames`, the thin I/O glue that reads `metadata.json` via the config singleton and calls the lib's pure functions.

**Tech Stack:** Python ≥3.10, uv (editable path dependency), pytest. `geo` is pure stdlib (`math`, `json`, `pathlib`, `dataclasses`) — it adds **no** third-party dependency to the library.

> **Revision (2026-06-19, during execution):** A design grill changed two things from the
> task bodies below. (1) `geo` stays **pure geometry** — `LocatedFrame` and the
> frame-location functions do **not** move into the library; they stay app-side, and a
> shared `Frame`-locator is deferred to the `artifacts` step (lib ADR-0001). The library
> instead gains a pure `coordinates_in_area(area, coords) -> list[Coordinate]` filter and a
> `geo/constants.py`. (2) `Area.from_payload` is **generic-only** (`{"geometries": [...]}`);
> the webapp adds a `src/geo/area_payload.py::parse_area_payload` bridge that wraps the
> legacy single-shape body, and the multi-area frontend is a separate feature
> (`docs/feature-requests/2026-06-19-frontend-multi-area-selection.md`). Tasks 1–2 are as
> written; Tasks 3–4 reflect this revision.

## Global Constraints

- **Two separate git repos.** `data-extraction-lib` (`git@gitlab.com:niulinx/aida/aida-tools/data-extraction-lib.git`, default branch `main`) and `Chat2Bag` (`github.com/paolopertino/Chat2Bag`, work branch `refactor/extract-data-extraction-lib`). Commit lib changes in the lib repo, webapp changes in the Chat2Bag repo — never mix.
- **Library import path:** `data_extraction_lib` (src layout, `uv_build` backend). Geo lives at `data-extraction-lib/src/data_extraction_lib/geo/`.
- **Dependency invariant:** `geo` must not import anything ROS-related, FastAPI, or any Chat2Bag config. Pure domain only.
- **Integration is editable-path for now.** The git-tag pin (`data-extraction-lib @ git+ssh://…@v0.1.0`) is deferred to the very end of the whole migration, not this step.
- **Webapp test command:** `PYTHONPATH="" uv run pytest tests/` (the empty `PYTHONPATH` is required — the host ROS2 env otherwise leaks onto `sys.path`).
- **Lib test command:** `uv run pytest -q` from inside `data-extraction-lib`.
- **Behavior must not change.** The webapp's API/service tests are the UI-behavior proxy and must stay green; the API area-payload JSON format (`{kind, center, radius_m}` / `{kind, vertices}`) is unchanged.
- Python naming: snake_case files/functions, PascalCase classes. No Prettier. Frozen dataclasses for value objects.

---

### Task 1: Wire the editable dependency and lib test harness

**Files:**
- Modify: `Chat2Bag/pyproject.toml` (adds `data-extraction-lib` dep + `[tool.uv.sources]`), `Chat2Bag/uv.lock`
- Modify: `data-extraction-lib/pyproject.toml` (adds pytest dev dep), `data-extraction-lib/uv.lock` (created)

**Interfaces:**
- Consumes: nothing.
- Produces: `data_extraction_lib` importable from the Chat2Bag venv; `uv run pytest` works in the lib.

- [ ] **Step 1: Branch the library for this work**

```bash
cd /home/paolopertino/adehome/aida_code/data-extraction-lib
git checkout -b feat/geo-extraction main
```

- [ ] **Step 2: Add pytest to the library as a dev dependency**

```bash
cd /home/paolopertino/adehome/aida_code/data-extraction-lib
uv add --dev pytest
```
Expected: creates `.venv` + `uv.lock`, `pyproject.toml` gains a `[dependency-groups] dev = ["pytest>=…"]`.

- [ ] **Step 3: Add the library to Chat2Bag as an editable path dependency**

```bash
cd /home/paolopertino/adehome/aida_code/Chat2Bag
uv add --editable ../data-extraction-lib
```
Expected: `Chat2Bag/pyproject.toml` gains `"data-extraction-lib"` in `dependencies` and
```toml
[tool.uv.sources]
data-extraction-lib = { path = "../data-extraction-lib", editable = true }
```
and `uv.lock` updates.

- [ ] **Step 4: Verify the lib is importable from the Chat2Bag venv**

```bash
cd /home/paolopertino/adehome/aida_code/Chat2Bag
PYTHONPATH="" uv run python -c "import data_extraction_lib; print('ok')"
```
Expected: prints `ok`.

- [ ] **Step 5: Commit — library repo**

```bash
cd /home/paolopertino/adehome/aida_code/data-extraction-lib
git add pyproject.toml uv.lock
git commit -m "[Config] Add pytest dev dependency

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 6: Commit — Chat2Bag repo**

```bash
cd /home/paolopertino/adehome/aida_code/Chat2Bag
git add pyproject.toml uv.lock
git commit -m "[Config] Depend on data-extraction-lib via editable path source

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `geo/area.py` in the library (Coordinate, Geometry, Circle, Polygon, Area, haversine)

**Files:**
- Create: `data-extraction-lib/src/data_extraction_lib/geo/__init__.py`
- Create: `data-extraction-lib/src/data_extraction_lib/geo/area.py`
- Test: `data-extraction-lib/tests/test_geo_area.py`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `Coordinate(lat: float, lon: float)` — frozen value object.
  - `haversine(lat1, lon1, lat2, lon2) -> float`.
  - `Geometry` (ABC): `.contains(point: Coordinate) -> bool`, `.bbox() -> tuple[float,float,float,float]`, classmethod `Geometry.from_payload(payload: dict) -> Geometry`.
  - `Circle(center: Coordinate, radius_m: float)`, `Polygon(vertices: tuple[Coordinate, ...])` — both `Geometry`, frozen.
  - `Area(geometries: tuple[Geometry, ...])` — frozen; `.contains(point: Coordinate) -> bool` (union); staticmethod `Area.from_payload(payload: dict | None) -> Area | None`.

- [ ] **Step 1: Write the failing test**

Create `data-extraction-lib/tests/test_geo_area.py`:

```python
import pytest

from data_extraction_lib.geo import Area, Circle, Coordinate, Polygon, haversine


def test_haversine_known_distance():
    # ~111.19 km per degree of latitude at the equator
    assert abs(haversine(0.0, 0.0, 1.0, 0.0) - 111195) < 500


def test_circle_contains_boundary():
    c = Circle(center=Coordinate(45.0, 10.0), radius_m=150.0)
    assert c.contains(Coordinate(45.0, 10.0)) is True
    assert c.contains(Coordinate(45.0 + 100.0 / 111195.0, 10.0)) is True   # ~100 m north
    assert c.contains(Coordinate(45.0 + 300.0 / 111195.0, 10.0)) is False  # ~300 m north


def test_polygon_contains_and_outside():
    sq = Polygon(vertices=(
        Coordinate(0.0, 0.0), Coordinate(0.0, 2.0), Coordinate(2.0, 2.0), Coordinate(2.0, 0.0),
    ))
    assert sq.contains(Coordinate(1.0, 1.0)) is True
    assert sq.contains(Coordinate(3.0, 3.0)) is False
    assert sq.contains(Coordinate(1.0, 5.0)) is False  # outside bbox fast-path


def test_area_union_contains():
    a = Area(geometries=(Circle(center=Coordinate(45.0, 10.0), radius_m=150.0),))
    assert a.contains(Coordinate(45.0, 10.0)) is True
    assert a.contains(Coordinate(0.0, 0.0)) is False


def test_area_from_payload_circle_and_polygon():
    a = Area.from_payload({"kind": "circle", "center": {"lat": 45.0, "lon": 10.0}, "radius_m": 120})
    assert a == Area(geometries=(Circle(center=Coordinate(45.0, 10.0), radius_m=120.0),))
    p = Area.from_payload({"kind": "polygon", "vertices": [
        {"lat": 0.0, "lon": 0.0}, {"lat": 0.0, "lon": 1.0}, {"lat": 1.0, "lon": 1.0}]})
    assert p == Area(geometries=(Polygon(vertices=(
        Coordinate(0.0, 0.0), Coordinate(0.0, 1.0), Coordinate(1.0, 1.0))),))


def test_area_from_payload_none_and_bad():
    assert Area.from_payload(None) is None
    with pytest.raises(ValueError):
        Area.from_payload({"kind": "blob"})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/paolopertino/adehome/aida_code/data-extraction-lib && uv run pytest tests/test_geo_area.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'data_extraction_lib.geo'`.

- [ ] **Step 3: Write the implementation**

Create `data-extraction-lib/src/data_extraction_lib/geo/area.py`:

```python
"""Geographic geometry types + point-in-area tests (pure, ROS-agnostic)."""
import math
from abc import ABC, abstractmethod
from dataclasses import dataclass

_EARTH_RADIUS_M = 6_371_000.0


@dataclass(frozen=True)
class Coordinate:
    lat: float
    lon: float


def haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in metres between two WGS84 points."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * _EARTH_RADIUS_M * math.asin(math.sqrt(a))


def _point_in_polygon(lat: float, lon: float, vertices: "tuple[Coordinate, ...]") -> bool:
    """Ray casting on (x=lon, y=lat)."""
    inside = False
    n = len(vertices)
    j = n - 1
    for i in range(n):
        yi, xi = vertices[i].lat, vertices[i].lon
        yj, xj = vertices[j].lat, vertices[j].lon
        if (yi > lat) != (yj > lat):
            x_cross = (xj - xi) * (lat - yi) / (yj - yi) + xi
            if lon < x_cross:
                inside = not inside
        j = i
    return inside


class Geometry(ABC):
    """A single spatial shape with containment + bounding box."""

    @abstractmethod
    def contains(self, point: Coordinate) -> bool:
        ...

    @abstractmethod
    def bbox(self) -> tuple[float, float, float, float]:
        """(min_lat, min_lon, max_lat, max_lon)."""
        ...

    @classmethod
    def from_payload(cls, payload: dict) -> "Geometry":
        """Parse one API shape object (spec §5.1) into a Geometry."""
        kind = payload.get("kind")
        if kind == "circle":
            c = payload["center"]
            return Circle(
                center=Coordinate(float(c["lat"]), float(c["lon"])),
                radius_m=float(payload["radius_m"]),
            )
        if kind == "polygon":
            verts = tuple(Coordinate(float(v["lat"]), float(v["lon"])) for v in payload["vertices"])
            return Polygon(vertices=verts)
        raise ValueError(f"Unknown area kind: {kind!r}")


@dataclass(frozen=True)
class Circle(Geometry):
    center: Coordinate
    radius_m: float

    def bbox(self) -> tuple[float, float, float, float]:
        dlat = self.radius_m / 111_320.0
        coslat = max(math.cos(math.radians(self.center.lat)), 1e-6)
        dlon = self.radius_m / (111_320.0 * coslat)
        return (self.center.lat - dlat, self.center.lon - dlon,
                self.center.lat + dlat, self.center.lon + dlon)

    def contains(self, point: Coordinate) -> bool:
        min_lat, min_lon, max_lat, max_lon = self.bbox()
        if not (min_lat <= point.lat <= max_lat and min_lon <= point.lon <= max_lon):
            return False
        return haversine(self.center.lat, self.center.lon, point.lat, point.lon) <= self.radius_m


@dataclass(frozen=True)
class Polygon(Geometry):
    vertices: tuple[Coordinate, ...]  # >= 3

    def bbox(self) -> tuple[float, float, float, float]:
        lats = [v.lat for v in self.vertices]
        lons = [v.lon for v in self.vertices]
        return (min(lats), min(lons), max(lats), max(lons))

    def contains(self, point: Coordinate) -> bool:
        min_lat, min_lon, max_lat, max_lon = self.bbox()
        if not (min_lat <= point.lat <= max_lat and min_lon <= point.lon <= max_lon):
            return False
        return _point_in_polygon(point.lat, point.lon, self.vertices)


@dataclass(frozen=True)
class Area:
    """One or more geometries; a point is inside the Area if inside ANY of them."""
    geometries: tuple[Geometry, ...]

    def contains(self, point: Coordinate) -> bool:
        return any(g.contains(point) for g in self.geometries)

    @staticmethod
    def from_payload(payload: dict | None) -> "Area | None":
        """Parse the API `area` object into an Area.

        The current API sends a single shape; this wraps it as a one-geometry Area.
        Multi-shape payloads are a latent extension and are not produced today.
        """
        if payload is None:
            return None
        return Area(geometries=(Geometry.from_payload(payload),))
```

Create `data-extraction-lib/src/data_extraction_lib/geo/__init__.py`:

```python
from data_extraction_lib.geo.area import (
    Area,
    Circle,
    Coordinate,
    Geometry,
    Polygon,
    haversine,
)

__all__ = ["Area", "Circle", "Coordinate", "Geometry", "Polygon", "haversine"]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/paolopertino/adehome/aida_code/data-extraction-lib && uv run pytest tests/test_geo_area.py -q`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit — library repo**

```bash
cd /home/paolopertino/adehome/aida_code/data-extraction-lib
git add src/data_extraction_lib/geo/__init__.py src/data_extraction_lib/geo/area.py tests/test_geo_area.py
git commit -m "[Feat] geo: Coordinate, Geometry (Circle/Polygon), Area, haversine

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `geo/locator.py` (pure) in the library

**Files:**
- Create: `data-extraction-lib/src/data_extraction_lib/geo/locator.py`
- Modify: `data-extraction-lib/src/data_extraction_lib/geo/__init__.py` (export locator names)
- Test: `data-extraction-lib/tests/test_geo_locator.py`

**Interfaces:**
- Consumes: `Area`, `Coordinate` from `data_extraction_lib.geo.area` (Task 2).
- Produces:
  - `LocatedFrame(frame_id: int, file_path: str, topic: str, timestamp_ns: int, lat: float, lon: float)` — frozen.
  - `frames_in_area(area: Area, frames: list[dict]) -> list[int]`.
  - `located_frames_in_area(area: Area, frames: list[dict], artifact_dir: Path | None = None) -> list[LocatedFrame]`.

- [ ] **Step 1: Write the failing test**

Create `data-extraction-lib/tests/test_geo_locator.py`:

```python
from pathlib import Path

from data_extraction_lib.geo import Area, LocatedFrame, frames_in_area, located_frames_in_area


def _frame(ts, topic, fp, lat=None, lon=None):
    f = {"timestamp_ns": ts, "topic": topic, "file_path": fp}
    if lat is not None:
        f["lat"], f["lon"] = lat, lon
    return f


def _circle(lat, lon, r):
    return Area.from_payload({"kind": "circle", "center": {"lat": lat, "lon": lon}, "radius_m": r})


def test_frames_in_area_keeps_only_located_inside():
    frames = [
        _frame(1, "/c", "a.jpg", 45.0, 10.0),   # inside
        _frame(2, "/c", "b.jpg", 45.5, 10.5),   # outside
        _frame(3, "/c", "c.jpg"),               # unlocated → excluded
    ]
    assert frames_in_area(_circle(45.0, 10.0, 200.0), frames) == [0]


def test_located_frames_in_area_resolves_absolute_path():
    frames = [
        _frame(10, "/c", "thumbnails/c/f10.jpg", 45.0, 10.0),  # frame_id 0, inside
        _frame(20, "/c", "thumbnails/c/f20.jpg", 48.0, 12.0),  # frame_id 1, outside
    ]
    out = located_frames_in_area(_circle(45.0, 10.0, 300.0), frames, artifact_dir=Path("/art"))
    assert out == [LocatedFrame(
        frame_id=0, file_path=str(Path("/art") / "thumbnails/c/f10.jpg"),
        topic="/c", timestamp_ns=10, lat=45.0, lon=10.0,
    )]


def test_located_frames_in_area_keeps_relative_path_without_artifact_dir():
    frames = [_frame(10, "/c", "thumbnails/c/f10.jpg", 45.0, 10.0)]
    out = located_frames_in_area(_circle(45.0, 10.0, 300.0), frames)
    assert out[0].file_path == "thumbnails/c/f10.jpg"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/paolopertino/adehome/aida_code/data-extraction-lib && uv run pytest tests/test_geo_locator.py -q`
Expected: FAIL — `ImportError: cannot import name 'LocatedFrame'`.

- [ ] **Step 3: Write the implementation**

Create `data-extraction-lib/src/data_extraction_lib/geo/locator.py`:

```python
"""Locate frames inside an Area (pure: no config, no disk reads, no ROS)."""
from dataclasses import dataclass
from pathlib import Path

from data_extraction_lib.geo.area import Area, Coordinate


@dataclass(frozen=True)
class LocatedFrame:
    frame_id: int          # positional index into the frames list
    file_path: str         # relative to the artifact dir, or absolute if resolved
    topic: str
    timestamp_ns: int
    lat: float
    lon: float


def frames_in_area(area: Area, frames: list[dict]) -> list[int]:
    """Return frame_ids (list indices) of located frames inside `area`."""
    out: list[int] = []
    for frame_id, frame in enumerate(frames):
        lat, lon = frame.get("lat"), frame.get("lon")
        if lat is None or lon is None:
            continue
        if area.contains(Coordinate(float(lat), float(lon))):
            out.append(frame_id)
    return out


def located_frames_in_area(
    area: Area, frames: list[dict], artifact_dir: Path | None = None,
) -> list[LocatedFrame]:
    """Return LocatedFrame rows for the in-area frames of one bag.

    When `artifact_dir` is given, `file_path` is resolved to the ABSOLUTE on-disk
    path (`<artifact_dir>/<relative>`); without it the relative metadata path is kept.
    """
    result: list[LocatedFrame] = []
    for frame_id in frames_in_area(area, frames):
        f = frames[frame_id]
        file_path = str(artifact_dir / f["file_path"]) if artifact_dir is not None else f["file_path"]
        result.append(LocatedFrame(
            frame_id=frame_id,
            file_path=file_path,
            topic=f["topic"],
            timestamp_ns=int(f["timestamp_ns"]),
            lat=float(f["lat"]),
            lon=float(f["lon"]),
        ))
    return result
```

Replace `data-extraction-lib/src/data_extraction_lib/geo/__init__.py` with:

```python
from data_extraction_lib.geo.area import (
    Area,
    Circle,
    Coordinate,
    Geometry,
    Polygon,
    haversine,
)
from data_extraction_lib.geo.locator import (
    LocatedFrame,
    frames_in_area,
    located_frames_in_area,
)

__all__ = [
    "Area",
    "Circle",
    "Coordinate",
    "Geometry",
    "Polygon",
    "haversine",
    "LocatedFrame",
    "frames_in_area",
    "located_frames_in_area",
]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/paolopertino/adehome/aida_code/data-extraction-lib && uv run pytest -q`
Expected: PASS (all geo tests — Task 2 + Task 3).

- [ ] **Step 5: Commit — library repo**

```bash
cd /home/paolopertino/adehome/aida_code/data-extraction-lib
git add src/data_extraction_lib/geo/locator.py src/data_extraction_lib/geo/__init__.py tests/test_geo_locator.py
git commit -m "[Feat] geo: LocatedFrame + frames_in_area / located_frames_in_area

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Rewire Chat2Bag onto the library and delete the moved code

**Files:**
- Modify: `Chat2Bag/src/services/map_search_service.py:1-3,17,34-35`
- Modify: `Chat2Bag/src/retriever/global_search.py:15-16,113`
- Modify: `Chat2Bag/src/region/region_search.py:16-17,97`
- Rewrite: `Chat2Bag/src/geo/locator.py` (keep only `resolve_area_to_frames` + `_artifact_and_frames`)
- Delete: `Chat2Bag/src/geo/area.py`
- Rewrite: `Chat2Bag/tests/test_geo_locator.py` (keep only the `resolve_area_to_frames` tests)
- Delete: `Chat2Bag/tests/test_geo_area.py` (moved to the lib in Task 2)

**Interfaces:**
- Consumes: `Area`, `Circle`, `haversine`, `LocatedFrame`, `frames_in_area`, `located_frames_in_area` from `data_extraction_lib.geo` (Tasks 2–3).
- Produces: `resolve_area_to_frames(area: Area, bag_paths: list[str]) -> dict[str, list[LocatedFrame]]` from `src.geo.locator` (unchanged signature; now backed by the lib).

- [ ] **Step 1: Rewrite the webapp geo glue**

Replace `Chat2Bag/src/geo/locator.py` entirely with:

```python
"""Resolve an Area to the in-area Frame set per bag (reads metadata.json).

The geometry + pure location logic lives in `data_extraction_lib.geo`; this module
is the thin webapp glue that resolves artifact paths (via the app config) and reads
metadata.json off disk, then delegates to the library's pure functions.
"""
import json
from pathlib import Path

from data_extraction_lib.geo import LocatedFrame, located_frames_in_area
from data_extraction_lib.geo.area import Area

from src.core.storage import resolve_artifact_path

__all__ = ["LocatedFrame", "resolve_area_to_frames"]


def _artifact_and_frames(bag_path: str) -> tuple[Path, list[dict]]:
    artifact = resolve_artifact_path(bag_path=Path(bag_path))
    meta_path = artifact / "metadata.json"
    try:
        with meta_path.open("r", encoding="utf-8") as handle:
            return artifact, json.load(handle).get("frames", [])
    except (FileNotFoundError, OSError, json.JSONDecodeError):
        return artifact, []


def resolve_area_to_frames(area: Area, bag_paths: list[str]) -> dict[str, list[LocatedFrame]]:
    """For each bag: read metadata.json and return its in-area LocatedFrames.

    `file_path` is the ABSOLUTE on-disk path so it matches the LanceDB `file_path`
    column (Global compose IN-list) and is directly fetchable via `/api/image`.
    """
    out: dict[str, list[LocatedFrame]] = {}
    for bag_path in bag_paths:
        artifact, frames = _artifact_and_frames(bag_path)
        out[bag_path] = located_frames_in_area(area, frames, artifact_dir=artifact)
    return out
```

- [ ] **Step 2: Delete the moved area module**

```bash
cd /home/paolopertino/adehome/aida_code/Chat2Bag
git rm src/geo/area.py
```

- [ ] **Step 3: Rewire `map_search_service.py`**

Change the imports (lines 1-3) from:
```python
from src.core.app_config import AppConfig, get_app_config
from src.geo.area import Circle, area_from_payload, haversine
from src.geo.locator import resolve_area_to_frames
```
to:
```python
from src.core.app_config import AppConfig, get_app_config
from data_extraction_lib.geo import Area, Circle, haversine
from src.geo.locator import resolve_area_to_frames
```

Change line 17 from `area = area_from_payload(area_payload)` to:
```python
        area = Area.from_payload(area_payload)
```

Change the distance block (lines 34-35) from:
```python
                if isinstance(area, Circle):
                    row["distance_m"] = haversine(area.lat, area.lon, lf.lat, lf.lon)
```
to:
```python
                if len(area.geometries) == 1 and isinstance(area.geometries[0], Circle):
                    center = area.geometries[0].center
                    row["distance_m"] = haversine(center.lat, center.lon, lf.lat, lf.lon)
```

- [ ] **Step 4: Rewire `global_search.py`**

Change line 15 from `from src.geo.area import area_from_payload` to:
```python
from data_extraction_lib.geo import Area
```
(Leave line 16 `from src.geo.locator import resolve_area_to_frames` unchanged.)

Change line 113 from `area_obj = area_from_payload(area)` to:
```python
        area_obj = Area.from_payload(area)
```

- [ ] **Step 5: Rewire `region_search.py`**

Change lines 16-17 from:
```python
from src.geo.area import area_from_payload
from src.geo.locator import frames_in_area
```
to:
```python
from data_extraction_lib.geo import Area, frames_in_area
```

Change line 97 from `area_obj = area_from_payload(area)` to:
```python
        area_obj = Area.from_payload(area)
```

- [ ] **Step 6: Rewrite the webapp locator test (drop the moved pure test)**

Replace `Chat2Bag/tests/test_geo_locator.py` entirely with:

```python
import json

from data_extraction_lib.geo import Area, LocatedFrame
from src.geo.locator import resolve_area_to_frames
from src.core.app_config import get_app_config
from src.core.storage import resolve_artifact_path


def _frame(ts, topic, fp, lat=None, lon=None):
    f = {"timestamp_ns": ts, "topic": topic, "file_path": fp}
    if lat is not None:
        f["lat"], f["lon"] = lat, lon
    return f


def _circle(lat, lon, r):
    return Area.from_payload({"kind": "circle", "center": {"lat": lat, "lon": lon}, "radius_m": r})


def test_resolve_area_to_frames_per_bag_and_frame_id(tmp_path, monkeypatch):
    monkeypatch.setattr("src.core.app_config.get_app_config", get_app_config)
    bag = tmp_path / "bag1"
    artifact = resolve_artifact_path(bag_path=bag)
    artifact.mkdir(parents=True)
    meta = {"schema_version": 5, "frames": [
        _frame(10, "/c", "thumbnails/c/f10.jpg", 45.0, 10.0),  # frame_id 0, inside
        _frame(20, "/c", "thumbnails/c/f20.jpg", 48.0, 12.0),  # frame_id 1, outside
    ]}
    (artifact / "metadata.json").write_text(json.dumps(meta))

    out = resolve_area_to_frames(_circle(45.0, 10.0, 300.0), [str(bag)])
    located = out[str(bag)]
    assert len(located) == 1
    # file_path is ABSOLUTE — must match the LanceDB `file_path` column and /api/image.
    assert located[0] == LocatedFrame(
        frame_id=0, file_path=str(artifact / "thumbnails/c/f10.jpg"), topic="/c",
        timestamp_ns=10, lat=45.0, lon=10.0,
    )


def test_resolve_skips_bag_without_metadata(tmp_path):
    out = resolve_area_to_frames(_circle(45.0, 10.0, 100.0), [str(tmp_path / "nope")])
    assert out == {str(tmp_path / "nope"): []}
```

- [ ] **Step 7: Run the full webapp suite**

Run: `cd /home/paolopertino/adehome/aida_code/Chat2Bag && PYTHONPATH="" uv run pytest tests/ -q`
Expected: PASS — entire suite green, including `test_map_search_service.py`, `test_map_api.py`, `test_global_search_area.py`, `test_region_search_area.py`, `test_frame_location.py`, and the rewritten `test_geo_locator.py`. No `test_geo_area.py` collected (it was deleted; it lives in the lib now).

- [ ] **Step 8: Commit — Chat2Bag repo**

```bash
cd /home/paolopertino/adehome/aida_code/Chat2Bag
git add src/geo/locator.py src/services/map_search_service.py src/retriever/global_search.py src/region/region_search.py tests/test_geo_locator.py
git rm --cached src/geo/area.py tests/test_geo_area.py 2>/dev/null; true
git commit -m "[Backend] Rewire geo onto data-extraction-lib; drop moved src/geo/area.py

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: End-to-end verification (UI behavior unchanged)

**Files:** none (verification only).

**Interfaces:**
- Consumes: the running webapp serving the built frontend.
- Produces: confirmation the map Area filter, global area-filtered search, and region area-filtered search behave exactly as before.

- [ ] **Step 1: Confirm both test suites are green**

```bash
cd /home/paolopertino/adehome/aida_code/data-extraction-lib && uv run pytest -q
cd /home/paolopertino/adehome/aida_code/Chat2Bag && PYTHONPATH="" uv run pytest tests/ -q
```
Expected: both PASS.

- [ ] **Step 2: Build the frontend (only if `static/` is stale)**

```bash
cd /home/paolopertino/adehome/aida_code/Chat2Bag/frontend && npm run build
```
Expected: builds to `../static/`.

- [ ] **Step 3: Start the backend**

```bash
cd /home/paolopertino/adehome/aida_code/Chat2Bag
JWT_SECRET=dev REFRESH_SECRET=dev uv run uvicorn app:app
```
Expected: serves at http://localhost:8000 with no import errors at startup (confirms the editable lib loads in the real app).

- [ ] **Step 4: Manual UI smoke (map Area filter)**

In the browser at http://localhost:8000:
1. Log in (use an existing user, or create one via `scripts/manage_users.py`).
2. On the Map home, draw a **circle** area with `AreaDraw`; confirm the ResultsRail populates with in-area frames and orange pins render (the `MapSearchService.browse` path through the new `Area`).
3. Run a **text search** with the area active; confirm area-filtered global results return as before (`global_search` area path).
4. If region search is enabled, run a **region/image search** with the area active; confirm results return (`region_search` area path).
5. Draw a **polygon** area and repeat step 2; confirm polygon containment still filters correctly.

Expected: identical behavior to before the migration — no errors, no empty/incorrect results, distance ordering for circle browse unchanged.

- [ ] **Step 5: Note the deferred final step**

No commit here. Record that the **path→git-tag source switch** (pin `data-extraction-lib @ git+ssh://…@v0.1.0`) is intentionally deferred until the entire migration (geo → embedding → artifacts → ros2 → index) is complete and the lib is tagged. Until then the editable path source from Task 1 remains.

---

## Self-Review

**Spec coverage:** This plan covers only the `geo` step of the migration spec (`docs/superpowers/specs/2026-06-18-data-extraction-lib-migration-design.md` §8 "Step 1 — geo"). It honors: the dependency-direction rule (geo imports nothing app-side), the agnostic-core invariant (no ROS), the object model (`Coordinate`/`Geometry`/`Circle`/`Polygon`/`Area`-as-composition, `LocatedFrame`), the "remodel as we move" decision (final OOP shape on arrival), the integration mechanism (editable path now, git tag deferred), and the verification loop (unit tests move to the lib; webapp API/service tests stay green; UI smoke). `Fix` is intentionally **not** in this step — it is coupled to `gps.py` and moves with the `ros2` step.

**Placeholder scan:** No TBD/TODO; every code step contains complete code; every command has an expected result.

**Type consistency:** `Area.from_payload` / `Geometry.from_payload` names are consistent across Tasks 2–4; `Circle(center=Coordinate, radius_m=…)`, `Polygon(vertices=tuple[Coordinate,…])`, `LocatedFrame(frame_id, file_path, topic, timestamp_ns, lat, lon)`, and `resolve_area_to_frames(area, bag_paths)` are used identically in the lib, the consumers, and the tests. `map_search_service` reads `area.geometries[0].center.{lat,lon}` matching the `Circle.center: Coordinate` definition in Task 2.
