# Map Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ROS2-bag Frames searchable by *where in the world* they were captured — the user draws an **Area** (circle or polygon) on a map, and the app returns the in-area Frames, standalone (browse) or as a prefilter composed with Global/Region search.

**Architecture:** Ingestion reads the GPS topic in the existing bag pass, joins each Frame to its nearest valid Fix (±1.0 s) and persists a per-Frame `lat`/`lon` + a `gps` stamp in `metadata.json` (schema v5). At query time a new in-Python `src/geo/` module resolves an Area to an in-area Frame set with no spatial index; that set *is* the browse result and *prefilters* the two existing rankers (LanceDB `IN`-list for Global, faiss `IDSelector` for Region). A full-screen Leaflet dialog drives the Area. See `docs/superpowers/specs/2026-06-03-map-search-design.md` (the contract) and `docs/adr/0005-map-search-no-spatial-index.md`.

**Tech Stack:** Python 3.10+ (FastAPI, rosbags 0.11, lancedb 0.27.1, faiss-cpu 1.14.2, pytest), TypeScript/React 19 (Vite 8, Leaflet + react-leaflet v5 + geoman).

**Spikes (already validated — DO NOT re-run):**
- LanceDB `table.search(q).where("file_path IN (…)", prefilter=True)` is exact, ~30 ms full-table, does not empty small sets. No fallback needed.
- faiss `IDSelector` via `SearchParametersIVF` works on faiss-cpu 1.14.2 **but** at the resident `nprobe=16` it under-recalls small Areas. **Decision: set `nprobe = nlist` (exhaustive) whenever an Area is active** — the selector bounds the cost to ~6–41 ms. The old over-fetch+post-filter fallback is dropped.
- `sensor_msgs/msg/NavSatFix` is in `rosbags` `Stores.LATEST`; both target bags carry `/oxts/nav_sat_fix` as that standard type.

---

## Conventions (read once)

- **Run backend tests:** `PYTHONPATH="" uv run pytest tests/<file> -v` (empty `PYTHONPATH` is mandatory — the host ROS2 env otherwise breaks plugin discovery). Async mode is auto; config in `pyproject.toml` `[tool.pytest.ini_options]` (`asyncio_mode = "auto"`, `pythonpath = ["."]`).
- **`get_app_config()` is `@lru_cache(maxsize=1)`** — config tests monkeypatch `src.core.app_config.get_settings` and wrap the body in `get_app_config.cache_clear()` … `finally: get_app_config.cache_clear()`. To vary one field without touching the singleton, use `dataclasses.replace`.
- **Auth is router-level** (`dependencies=[Depends(require_current_user)]` on each `APIRouter`), so new endpoints on existing routers are authed automatically. Tests bypass via the `bypass_auth` fixture (`tests/conftest.py`) or an inline `app.dependency_overrides[require_current_user] = lambda: User(id=1, username="test-user", is_active=True)`.
- **Fakes** live in `tests/fakes.py` (`FakeEmbedder`, `FakeDenseEmbedder`). Synthetic-bag factories to copy: `_make_bag` (`tests/test_indexer_embedding.py`), `_make_region_bag` (`tests/test_region_search.py`).
- **`frame_id` = positional index into `metadata["frames"]`** everywhere (the region index already relies on this). The GPS join and the locator MUST preserve it.
- **`file_path` in `metadata.json` and in LanceDB is RELATIVE to the artifact dir** (e.g. `thumbnails/<slug>/frame_<ts>.jpg`). The Global `IN`-list uses these relative strings — they match the LanceDB column directly.
- **Commit cadence:** one commit per task (after its tests pass). Conventional messages with house tags: `[Backend]`, `[API]`, `[Config]`, `[UI]`. Branch is `feature/satellite-filtering`.
- **Frontend has no unit-test harness** (ESLint only, no Prettier). Slice 4 tasks gate on `cd frontend && npm run lint` and `npm run build` (`tsc -b && vite build` — type errors fail the build) plus explicit manual checks.

---

## File Structure

**New backend files**
- `src/ingestion/gps.py` — `Fix` dataclass; `fix_from_navsatfix` (validity filter); `read_fixes` (standalone pass, for future backfill); `locate_frames` (nearest-Fix join).
- `src/geo/__init__.py`
- `src/geo/area.py` — `Circle`, `Polygon`, `Area`; `haversine`, `contains`, `bbox`; `area_from_payload`.
- `src/geo/locator.py` — `LocatedFrame`; `frames_in_area`; `located_frames_in_area`; `resolve_area_to_frames`.
- `src/services/map_search_service.py` — `MapSearchService.browse`.

**Modified backend files**
- `src/core/app_config.py` (config fields), `src/core/schema_versions.py` (v5), `src/core/index_stamp.py` (`read_gps_stamp`, `build_gps_stamp`, `gps_is_located`).
- `src/ingestion/bag_parser.py` (GPS read + join + per-frame lat/lon + `gps` stamp).
- `src/retriever/global_search.py` (`area` prefilter), `src/region/region_search.py` + `src/region/faiss_index.py` (`area` via `IDSelector` + exhaustive nprobe).
- `src/services/search_service.py`, `src/services/region_search_service.py` (`area` arg), `src/services/component_factory.py` (`create_map_search_service`).
- `src/api/search_routes.py` (Area models + `area` on existing + `POST /api/search/map`), `src/api/bags.py` (`is_located` + `GET /api/bags/track`), `src/api/dependencies.py` (`get_map_search_service`), `app.py` (none required — map service built per-request via the factory).
- `config/settings.yaml`.

**New frontend files**
- `frontend/src/lib/area-codec.ts`, `frontend/src/lib/area-geo.ts` (TS point-in-area for the live count).
- `frontend/src/hooks/use-map-area.ts`, `frontend/src/hooks/use-bag-tracks.ts`.
- `frontend/src/components/search/area-chip.tsx`, `frontend/src/components/search/map-area-dialog.tsx`.
- `frontend/src/components/map/bag-trajectories.tsx`, `frontend/src/components/map/area-layer.tsx`.

**Modified frontend files**
- `frontend/src/api/types.ts`, `frontend/src/api/client.ts`, `frontend/src/pages/search.tsx`, `frontend/package.json`.

---

# SLICE 0 — GPS read + join (backend, no product surface)

Goal: re-extracting a bag with a GPS topic attaches `lat`/`lon` to located Frames and writes a `gps` stamp; schema → v5.

## Task 0.1: Config fields — `gps_topic`, `gps_max_gap_sec`, `map_browse_cap`

**Files:**
- Modify: `src/core/app_config.py`
- Modify: `config/settings.yaml`
- Test: `tests/test_app_config.py`

- [ ] **Step 1: Write the failing tests.** Append to `tests/test_app_config.py` (the module already imports `src.core.app_config as app_config_mod` and defines `_FAKE_SETTINGS`). First extend `_FAKE_SETTINGS`'s `"ingestion"` block with `"gps_topic": "/oxts/nav_sat_fix", "gps_max_gap_sec": 1.0` and its `"search"` block with `"map_browse_cap": 500`. Then add:

```python
def test_ingestion_gps_fields_parsed(monkeypatch):
    monkeypatch.setattr(app_config_mod, "get_settings", lambda: _FAKE_SETTINGS)
    app_config_mod.get_app_config.cache_clear()
    try:
        cfg = app_config_mod.get_app_config()
        assert cfg.ingestion.gps_topic == "/oxts/nav_sat_fix"
        assert cfg.ingestion.gps_max_gap_sec == 1.0
        assert cfg.search.map_browse_cap == 500
    finally:
        app_config_mod.get_app_config.cache_clear()


def test_gps_fields_default_when_absent(monkeypatch):
    trimmed = {**_FAKE_SETTINGS, "ingestion": {
        k: v for k, v in _FAKE_SETTINGS["ingestion"].items()
        if k not in ("gps_topic", "gps_max_gap_sec")
    }, "search": {}}
    monkeypatch.setattr(app_config_mod, "get_settings", lambda: trimmed)
    app_config_mod.get_app_config.cache_clear()
    try:
        cfg = app_config_mod.get_app_config()
        assert cfg.ingestion.gps_topic is None
        assert cfg.ingestion.gps_max_gap_sec == 1.0
        assert cfg.search.map_browse_cap == 500
    finally:
        app_config_mod.get_app_config.cache_clear()
```

- [ ] **Step 2: Run to verify failure.** `PYTHONPATH="" uv run pytest tests/test_app_config.py -v` → FAIL (`AttributeError`/`KeyError` — fields don't exist).

- [ ] **Step 3: Add the dataclass fields.** In `src/core/app_config.py`, change `IngestionConfig` (currently lines 9-14) to:

```python
@dataclass(frozen=True)
class IngestionConfig:
    camera_topics: tuple[str, ...]
    sampling_fps: float
    long_side: int
    batch_size: int
    gps_topic: Optional[str]
    gps_max_gap_sec: float
```

and `SearchConfig` (currently lines 37-39) to:

```python
@dataclass(frozen=True)
class SearchConfig:
    temporal_dedup_window_sec: float
    map_browse_cap: int
```

(`Optional` is already imported in this module — it is used by `StorageConfig`/`RegionSearchConfig`.)

- [ ] **Step 4: Parse the fields.** In `get_app_config()`, extend the `IngestionConfig(...)` call with:

```python
            gps_topic=(
                str(settings["ingestion"]["gps_topic"])
                if settings["ingestion"].get("gps_topic")
                else None
            ),
            gps_max_gap_sec=float(settings["ingestion"].get("gps_max_gap_sec", 1.0)),
```

and the `SearchConfig(...)` call with:

```python
            map_browse_cap=int(settings.get("search", {}).get("map_browse_cap", 500)),
```

- [ ] **Step 5: Update settings.yaml.** In `config/settings.yaml`, under `ingestion:` add (after `batch_size`):

```yaml
  gps_topic: "/oxts/nav_sat_fix"   # GPS topic read during extraction for Map search (null => no GPS read)
  gps_max_gap_sec: 1.0             # Nearest-Fix join tolerance (seconds); frames with no Fix within this gap get no location
```

and under `search:` add:

```yaml
  map_browse_cap: 500             # Max Map-browse results returned after temporal dedup
```

- [ ] **Step 6: Run to verify pass.** `PYTHONPATH="" uv run pytest tests/test_app_config.py -v` → PASS. Also run the whole file to confirm the `_FAKE_SETTINGS` edits didn't break sibling tests.

- [ ] **Step 7: Commit.**

```bash
git add src/core/app_config.py config/settings.yaml tests/test_app_config.py
git commit -m "[Config] feat: add gps_topic, gps_max_gap_sec, map_browse_cap settings"
```

## Task 0.2: Bump metadata schema to v5

**Files:**
- Modify: `src/core/schema_versions.py`
- Test: `tests/test_schema_version.py` (new)

- [ ] **Step 1: Write the failing test.** Create `tests/test_schema_version.py`:

```python
from src.core.schema_versions import METADATA_SCHEMA_VERSION


def test_schema_version_is_v5_for_map_search():
    assert METADATA_SCHEMA_VERSION == 5
```

- [ ] **Step 2: Run to verify failure.** `PYTHONPATH="" uv run pytest tests/test_schema_version.py -v` → FAIL (currently 4).

- [ ] **Step 3: Bump + changelog.** In `src/core/schema_versions.py`, add this line to the docstring version history (after the `4 — …` entry) and change the constant:

```
  5 — Adds optional per-frame `lat`/`lon` (Frame location) + top-level `gps` stamp
      (Map search). CLS/region layout unchanged from v4.
```

```python
METADATA_SCHEMA_VERSION = 5
```

- [ ] **Step 4: Run to verify pass.** `PYTHONPATH="" uv run pytest tests/test_schema_version.py -v` → PASS.
- [ ] **Step 5: Note** — `tests/test_region_stamp.py` asserts `schema_version == 4` in a synthetic metadata literal; it constructs its own dict, so the bump does not break it. Run `PYTHONPATH="" uv run pytest tests/test_region_stamp.py tests/test_indexer_embedding.py -v` to confirm. If any test hard-asserts the constant `== 4`, update that literal to 5.
- [ ] **Step 6: Commit.**

```bash
git add src/core/schema_versions.py tests/test_schema_version.py
git commit -m "[Backend] feat: bump metadata schema to v5 (per-frame GPS + gps stamp)"
```

## Task 0.3: `gps.py` — `Fix`, `fix_from_navsatfix` (validity), `locate_frames`

**Files:**
- Create: `src/ingestion/gps.py`
- Test: `tests/test_gps.py` (new)

- [ ] **Step 1: Write the failing tests.** Create `tests/test_gps.py`:

```python
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
```

- [ ] **Step 2: Run to verify failure.** `PYTHONPATH="" uv run pytest tests/test_gps.py -v` → FAIL (`ModuleNotFoundError`).

- [ ] **Step 3: Implement `src/ingestion/gps.py`.**

```python
"""GPS Fix reading + nearest-Fix Frame-location join (Map search).

Kept self-contained so a future lightweight "locate-only" backfill pass can
re-read the GPS topic without re-extracting thumbnails or re-embedding.
"""
import bisect
import math
from dataclasses import dataclass


@dataclass(frozen=True)
class Fix:
    """One valid GPS fix: bag timestamp (ns) + WGS84 lat/lon."""

    timestamp_ns: int
    lat: float
    lon: float


def fix_from_navsatfix(msg, timestamp_ns: int) -> "Fix | None":
    """Build a Fix from a deserialized sensor_msgs/msg/NavSatFix, or None if invalid.

    Validity (spec §2.1, non-negotiable): keep only if status.status >= 0
    (drops NO_FIX = -1) AND lat/lon are finite (NavSatFix carries NaN when unfixed).
    """
    if int(msg.status.status) < 0:
        return None
    lat = float(msg.latitude)
    lon = float(msg.longitude)
    if not (math.isfinite(lat) and math.isfinite(lon)):
        return None
    return Fix(timestamp_ns=int(timestamp_ns), lat=lat, lon=lon)


def locate_frames(frames: list[dict], fixes: list["Fix"], max_gap_ns: int) -> int:
    """Attach lat/lon to each frame from its nearest Fix within max_gap_ns.

    Mutates `frames` in place (adds "lat"/"lon" when a Fix is within tolerance;
    leaves them absent otherwise — no interpolation). Returns the located count.
    """
    if not fixes:
        return 0
    ordered = sorted(fixes, key=lambda f: f.timestamp_ns)
    fix_ts = [f.timestamp_ns for f in ordered]
    located = 0
    for frame in frames:
        t = int(frame["timestamp_ns"])
        i = bisect.bisect_left(fix_ts, t)
        best = None
        for cand in (i - 1, i):
            if 0 <= cand < len(ordered):
                gap = abs(ordered[cand].timestamp_ns - t)
                if gap <= max_gap_ns and (best is None or gap < best[0]):
                    best = (gap, ordered[cand])
        if best is not None:
            frame["lat"] = best[1].lat
            frame["lon"] = best[1].lon
            located += 1
    return located
```

- [ ] **Step 4: Run to verify pass.** `PYTHONPATH="" uv run pytest tests/test_gps.py -v` → PASS.
- [ ] **Step 5: Commit.**

```bash
git add src/ingestion/gps.py tests/test_gps.py
git commit -m "[Backend] feat: gps.py — Fix validity filter + nearest-Fix Frame-location join"
```

## Task 0.4: `gps.py` — `read_fixes` (standalone pass for backfill)

**Files:**
- Modify: `src/ingestion/gps.py`
- Test: `tests/test_gps.py`

- [ ] **Step 1: Write the failing test.** Append to `tests/test_gps.py`:

```python
from src.ingestion.gps import read_fixes


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
```

- [ ] **Step 2: Run to verify failure.** `PYTHONPATH="" uv run pytest tests/test_gps.py::test_read_fixes_filters_to_topic_and_validity -v` → FAIL (`ImportError`).

- [ ] **Step 3: Implement `read_fixes`** in `src/ingestion/gps.py`:

```python
def read_fixes(reader, gps_topic: str, typestore) -> list["Fix"]:
    """Read all valid Fixes from a bag's GPS topic in a single pass.

    Used by a future locate-only backfill; extraction reuses `fix_from_navsatfix`
    inline in its existing message loop instead of calling this.
    """
    gps_conns = [c for c in reader.connections if c.topic == gps_topic]
    if not gps_conns:
        return []
    fixes: list[Fix] = []
    for connection, timestamp_ns, rawdata in reader.messages(connections=gps_conns):
        msg = typestore.deserialize_cdr(rawdata, connection.msgtype)
        fix = fix_from_navsatfix(msg, timestamp_ns)
        if fix is not None:
            fixes.append(fix)
    return fixes
```

- [ ] **Step 4: Run to verify pass.** `PYTHONPATH="" uv run pytest tests/test_gps.py -v` → PASS.
- [ ] **Step 5: Commit.**

```bash
git add src/ingestion/gps.py tests/test_gps.py
git commit -m "[Backend] feat: gps.read_fixes single-pass reader (for future backfill)"
```

## Task 0.5: GPS stamp helpers in `index_stamp.py`

**Files:**
- Modify: `src/core/index_stamp.py`
- Test: `tests/test_index_stamp.py`

- [ ] **Step 1: Write the failing tests.** Append to `tests/test_index_stamp.py`:

```python
import json as _json

from src.core.index_stamp import build_gps_stamp, gps_is_located, read_gps_stamp


def test_build_gps_stamp_shape():
    stamp = build_gps_stamp(
        topic="/oxts/nav_sat_fix", max_gap_sec=1.0,
        fix_count=60112, located_frame_count=587, frame_count=642,
    )
    assert stamp == {
        "topic": "/oxts/nav_sat_fix", "max_gap_sec": 1.0,
        "fix_count": 60112, "located_frame_count": 587, "frame_count": 642,
    }


def test_read_gps_stamp_none_when_absent(tmp_path):
    p = tmp_path / "metadata.json"
    p.write_text(_json.dumps({"schema_version": 5, "frames": []}))
    assert read_gps_stamp(p) is None


def test_read_gps_stamp_returns_dict(tmp_path):
    p = tmp_path / "metadata.json"
    p.write_text(_json.dumps({"schema_version": 5, "gps": {"located_frame_count": 3}, "frames": []}))
    assert read_gps_stamp(p) == {"located_frame_count": 3}


def test_gps_is_located():
    assert gps_is_located({"located_frame_count": 1}) is True
    assert gps_is_located({"located_frame_count": 0}) is False
    assert gps_is_located(None) is False
```

- [ ] **Step 2: Run to verify failure.** `PYTHONPATH="" uv run pytest tests/test_index_stamp.py -v` → FAIL (`ImportError`).

- [ ] **Step 3: Implement** — append to `src/core/index_stamp.py`:

```python
def build_gps_stamp(
    *, topic: str, max_gap_sec: float, fix_count: int,
    located_frame_count: int, frame_count: int,
) -> dict:
    """The top-level `gps` stamp recorded in metadata.json (Map search)."""
    return {
        "topic": topic,
        "max_gap_sec": float(max_gap_sec),
        "fix_count": int(fix_count),
        "located_frame_count": int(located_frame_count),
        "frame_count": int(frame_count),
    }


def read_gps_stamp(metadata_path) -> dict | None:
    """Return the `gps` stamp from a metadata.json, or None if absent/unreadable."""
    try:
        with Path(metadata_path).open("r", encoding="utf-8") as handle:
            meta = json.load(handle)
    except (FileNotFoundError, OSError, json.JSONDecodeError):
        return None
    stamp = meta.get("gps")
    return stamp if isinstance(stamp, dict) else None


def gps_is_located(stamp: dict | None) -> bool:
    """True iff a bag has a GPS stamp with at least one located Frame."""
    return bool(stamp) and int(stamp.get("located_frame_count", 0)) > 0
```

(`json` and `Path` are already imported at the top of `index_stamp.py`.)

- [ ] **Step 4: Run to verify pass.** `PYTHONPATH="" uv run pytest tests/test_index_stamp.py -v` → PASS.
- [ ] **Step 5: Commit.**

```bash
git add src/core/index_stamp.py tests/test_index_stamp.py
git commit -m "[Backend] feat: gps stamp helpers (build/read/is_located)"
```

## Task 0.6: Wire GPS read + join into `BagParser.extract_frames`

**Files:**
- Modify: `src/ingestion/bag_parser.py`
- Test: `tests/test_bag_parser_gps.py` (new)

- [ ] **Step 1: Write the failing test.** Create `tests/test_bag_parser_gps.py`. It drives `extract_frames` with a fake `rosbags` Reader/typestore + a stubbed `message_to_cvimage`, so it runs without a real bag. The fake yields interleaved camera + GPS messages; we assert located frames + the `gps` stamp.

```python
import json
import types
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
```

- [ ] **Step 2: Run to verify failure.** `PYTHONPATH="" uv run pytest tests/test_bag_parser_gps.py -v` → FAIL (no GPS handling; `gps` key absent).

- [ ] **Step 3: Implement.** In `src/ingestion/bag_parser.py`:

  a. Add imports near the top (after the existing `from src.core...` imports):

```python
from src.core.index_stamp import build_gps_stamp
from src.ingestion.gps import fix_from_navsatfix, locate_frames
```

  b. In `BagParser.__init__`, after `self.long_side = ...`, capture the GPS config:

```python
        self.gps_topic = app_config.ingestion.gps_topic
        self.gps_max_gap_ns = int(app_config.ingestion.gps_max_gap_sec * 1e9)
```

  c. In `extract_frames`, add `"gps": None` to the initial `metadata` dict (so the key always exists):

```python
        metadata = {
            "schema_version": METADATA_SCHEMA_VERSION,
            "bag_name": self.bag_path.name,
            "cameras": [],
            "embedder": None,
            "gps": None,
            "frames": [],
        }
```

  d. Inside the `with Reader(self.bag_path) as reader:` block, extend the connection set to include the GPS topic and detect its presence. Replace the `connections = [...]` / `present_topics = ...` block with:

```python
            camera_connections = [c for c in reader.connections if c.topic in self.topics]
            present_topics = sorted({c.topic for c in camera_connections})
            if not present_topics:
                raise ValueError(
                    f"None of the configured camera topics {list(self.topics)} "
                    f"found in {self.bag_path.name}"
                )
            metadata["cameras"] = present_topics

            gps_connections = (
                [c for c in reader.connections if c.topic == self.gps_topic]
                if self.gps_topic else []
            )
            connections = camera_connections + gps_connections
            fixes: list = []
```

  e. In the message loop, branch on the GPS topic BEFORE the camera sampling logic. Change the loop body so the first statements are:

```python
            for connection, timestamp_ns, rawdata in reader.messages(connections=connections):
                topic = connection.topic

                if self.gps_topic and topic == self.gps_topic:
                    try:
                        gps_msg = self.typestore.deserialize_cdr(rawdata, connection.msgtype)
                        fix = fix_from_navsatfix(gps_msg, timestamp_ns)
                        if fix is not None:
                            fixes.append(fix)
                    except (ValueError, KeyError, RuntimeError):
                        logger.warning("Skipping unparseable GPS message at %s", timestamp_ns, exc_info=True)
                    continue

                prev = last_saved_ns.get(topic)
                if prev is not None and (timestamp_ns - prev) < interval_ns:
                    continue
                # ... existing camera extraction unchanged ...
```

  f. After the `with Reader(...)` block (before writing `metadata.json`), join + stamp:

```python
        if self.gps_topic and gps_connections:
            located = locate_frames(metadata["frames"], fixes, self.gps_max_gap_ns)
            metadata["gps"] = build_gps_stamp(
                topic=self.gps_topic,
                max_gap_sec=self.gps_max_gap_ns / 1e9,
                fix_count=len(fixes),
                located_frame_count=located,
                frame_count=len(metadata["frames"]),
            )
            logger.info("GPS: %d fixes, %d/%d frames located", len(fixes), located, len(metadata["frames"]))
```

  (`gps_connections` is defined whenever the `with` block runs; the guard `self.gps_topic and gps_connections` leaves `metadata["gps"]` as `None` when there is no GPS topic.)

- [ ] **Step 4: Run to verify pass.** `PYTHONPATH="" uv run pytest tests/test_bag_parser_gps.py -v` → PASS. Also `PYTHONPATH="" uv run pytest tests/test_bag_parser_helpers.py -v` (helpers untouched, must still pass).

- [ ] **Step 5: Real-bag smoke (manual, not committed).** Re-extract one real bag and confirm the stamp:

```bash
PYTHONPATH="" uv run python -m src.ingestion.bag_parser /home/paolopertino/adehome/aida_code/bags/2026-01-21_09-53
python3 -c "import json; m=json.load(open('/home/paolopertino/adehome/aida_code/bags/2026-01-21_09-53/.bag_chat/metadata.json')); print(m['gps']); print(sum('lat' in f for f in m['frames']), 'located /', len(m['frames']))"
```

Expect a populated `gps` stamp and a high located ratio. (This overwrites metadata.json; re-running full indexing is Task 2/3's concern.)

- [ ] **Step 6: Commit.**

```bash
git add src/ingestion/bag_parser.py tests/test_bag_parser_gps.py
git commit -m "[Backend] feat: read GPS topic in extraction pass; attach Frame locations + gps stamp"
```

---

# SLICE 1 — Area + locator (`src/geo/`)

## Task 1.1: `geo/area.py` — Area types, containment, payload parsing

**Files:**
- Create: `src/geo/__init__.py` (empty)
- Create: `src/geo/area.py`
- Test: `tests/test_geo_area.py` (new)

- [ ] **Step 1: Write the failing tests.** Create `tests/test_geo_area.py`:

```python
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
```

- [ ] **Step 2: Run to verify failure.** `PYTHONPATH="" uv run pytest tests/test_geo_area.py -v` → FAIL (`ModuleNotFoundError`).

- [ ] **Step 3: Create `src/geo/__init__.py`** (empty file) and implement `src/geo/area.py`:

```python
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
```

- [ ] **Step 4: Run to verify pass.** `PYTHONPATH="" uv run pytest tests/test_geo_area.py -v` → PASS.
- [ ] **Step 5: Commit.**

```bash
git add src/geo/__init__.py src/geo/area.py tests/test_geo_area.py
git commit -m "[Backend] feat: geo/area.py — Circle/Polygon containment + payload parsing"
```

## Task 1.2: `geo/locator.py` — resolve Area → in-area Frames

**Files:**
- Create: `src/geo/locator.py`
- Test: `tests/test_geo_locator.py` (new)

- [ ] **Step 1: Write the failing tests.** Create `tests/test_geo_locator.py`:

```python
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
    assert located[0] == LocatedFrame(
        frame_id=0, file_path="thumbnails/c/f10.jpg", topic="/c",
        timestamp_ns=10, lat=45.0, lon=10.0,
    )


def test_resolve_skips_bag_without_metadata(tmp_path):
    out = resolve_area_to_frames(Circle(45.0, 10.0, 100.0), [str(tmp_path / "nope")])
    assert out == {str(tmp_path / "nope"): []}
```

- [ ] **Step 2: Run to verify failure.** `PYTHONPATH="" uv run pytest tests/test_geo_locator.py -v` → FAIL (`ModuleNotFoundError`).

- [ ] **Step 3: Implement `src/geo/locator.py`.**

```python
"""Resolve an Area to the in-area Frame set per bag (reads metadata.json)."""
import json
from dataclasses import dataclass
from pathlib import Path

from src.core.storage import resolve_artifact_path
from src.geo.area import Area, contains


@dataclass(frozen=True)
class LocatedFrame:
    frame_id: int          # positional index into metadata["frames"]
    file_path: str         # relative to the artifact dir (matches LanceDB)
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
        if contains(area, float(lat), float(lon)):
            out.append(frame_id)
    return out


def located_frames_in_area(area: Area, frames: list[dict]) -> list[LocatedFrame]:
    """Return LocatedFrame rows for the in-area frames of one bag."""
    result: list[LocatedFrame] = []
    for frame_id in frames_in_area(area, frames):
        f = frames[frame_id]
        result.append(LocatedFrame(
            frame_id=frame_id,
            file_path=f["file_path"],
            topic=f["topic"],
            timestamp_ns=int(f["timestamp_ns"]),
            lat=float(f["lat"]),
            lon=float(f["lon"]),
        ))
    return result


def _load_frames(bag_path: str) -> list[dict]:
    meta_path = resolve_artifact_path(bag_path=Path(bag_path)) / "metadata.json"
    try:
        with meta_path.open("r", encoding="utf-8") as handle:
            return json.load(handle).get("frames", [])
    except (FileNotFoundError, OSError, json.JSONDecodeError):
        return []


def resolve_area_to_frames(area: Area, bag_paths: list[str]) -> dict[str, list[LocatedFrame]]:
    """For each bag: read metadata.json and return its in-area LocatedFrames."""
    return {bag_path: located_frames_in_area(area, _load_frames(bag_path)) for bag_path in bag_paths}
```

- [ ] **Step 4: Run to verify pass.** `PYTHONPATH="" uv run pytest tests/test_geo_locator.py -v` → PASS.
- [ ] **Step 5: Commit.**

```bash
git add src/geo/locator.py tests/test_geo_locator.py
git commit -m "[Backend] feat: geo/locator.py — resolve Area to in-area Frames per bag"
```

---

# SLICE 2 — Browse + Global compose + API

## Task 2.1: `MapSearchService.browse`

**Files:**
- Create: `src/services/map_search_service.py`
- Test: `tests/test_map_search_service.py` (new)

Browse semantics (spec §4.1): resolve Area → in-area frames; temporal-dedup per `(bag, topic)` keeping the **earliest** in each window (no score); order chronologically by `(bag_path, timestamp_ns)`; attach `distance_m` for circles; cap at `map_browse_cap`. Result rows reuse the `SearchResult` shape minus `similarity_score`, plus `lat`/`lon`/`distance_m`.

- [ ] **Step 1: Write the failing tests.** Create `tests/test_map_search_service.py`:

```python
import dataclasses
import json

from src.core.app_config import get_app_config
from src.core.storage import resolve_artifact_path
from src.services.map_search_service import MapSearchService


def _write_bag(tmp_path, name, frames):
    bag = tmp_path / name
    artifact = resolve_artifact_path(bag_path=bag)
    artifact.mkdir(parents=True)
    (artifact / "metadata.json").write_text(json.dumps({"schema_version": 5, "frames": frames}))
    return str(bag)


def _f(ts, topic, fp, lat, lon):
    return {"timestamp_ns": ts, "topic": topic, "file_path": fp, "lat": lat, "lon": lon}


def test_browse_returns_in_area_chronological_no_score(tmp_path):
    s = 1_000_000_000
    bag = _write_bag(tmp_path, "b", [
        _f(1 * s, "/c", "f1.jpg", 45.0, 10.0),     # inside
        _f(2 * s, "/c", "f2.jpg", 48.0, 12.0),     # outside
        _f(3 * s, "/c", "f3.jpg", 45.0, 10.0001),  # inside
    ])
    svc = MapSearchService(config=get_app_config())
    rows = svc.browse({"kind": "circle", "center": {"lat": 45.0, "lon": 10.0}, "radius_m": 100},
                       [bag])
    # both inside frames are >20s? no — they are 2s apart, same (bag,topic) → dedup to earliest
    assert [r["timestamp_ns"] for r in rows] == [1 * s]
    assert "similarity_score" not in rows[0]
    assert rows[0]["lat"] == 45.0 and "distance_m" in rows[0]


def test_browse_keeps_separate_passes_and_all_cameras(tmp_path):
    s = 1_000_000_000
    bag = _write_bag(tmp_path, "b", [
        _f(1 * s, "/cam/a", "a1.jpg", 45.0, 10.0),
        _f(1 * s, "/cam/b", "b1.jpg", 45.0, 10.0),   # different camera, same time → kept
        _f(100 * s, "/cam/a", "a2.jpg", 45.0, 10.0), # >20s later, same camera → kept
    ])
    svc = MapSearchService(config=get_app_config())
    rows = svc.browse({"kind": "circle", "center": {"lat": 45.0, "lon": 10.0}, "radius_m": 100}, [bag])
    assert len(rows) == 3


def test_browse_cap_truncates(tmp_path):
    s = 1_000_000_000
    frames = [_f(i * 100 * s, "/c", f"f{i}.jpg", 45.0, 10.0) for i in range(10)]
    bag = _write_bag(tmp_path, "b", frames)
    base = get_app_config()
    cfg = dataclasses.replace(base, search=dataclasses.replace(base.search, map_browse_cap=3))
    svc = MapSearchService(config=cfg)
    rows = svc.browse({"kind": "circle", "center": {"lat": 45.0, "lon": 10.0}, "radius_m": 100}, [bag])
    assert len(rows) == 3


def test_browse_requires_bags():
    import pytest
    with pytest.raises(ValueError):
        MapSearchService(config=get_app_config()).browse(
            {"kind": "circle", "center": {"lat": 0, "lon": 0}, "radius_m": 1}, [])
```

- [ ] **Step 2: Run to verify failure.** `PYTHONPATH="" uv run pytest tests/test_map_search_service.py -v` → FAIL (`ModuleNotFoundError`).

- [ ] **Step 3: Implement `src/services/map_search_service.py`.**

```python
from src.core.app_config import AppConfig, get_app_config
from src.geo.area import Circle, area_from_payload, haversine
from src.geo.locator import resolve_area_to_frames


class MapSearchService:
    """Standalone Map browse: the in-area Frame set, deduped + chronological."""

    def __init__(self, config: AppConfig | None = None):
        cfg = config or get_app_config()
        self._dedup_window_ns = int(max(0.0, cfg.search.temporal_dedup_window_sec) * 1_000_000_000)
        self._cap = int(cfg.search.map_browse_cap)

    def browse(self, area_payload: dict, bag_paths: list[str], top_k: int | None = None) -> list[dict]:
        if not bag_paths:
            raise ValueError("Must provide at least one bag path.")
        area = area_from_payload(area_payload)
        if area is None:
            raise ValueError("An area is required for map browse.")

        rows: list[dict] = []
        per_bag = resolve_area_to_frames(area, bag_paths)
        for bag_path, located in per_bag.items():
            for lf in located:
                row = {
                    "bag_path": bag_path,
                    "timestamp_ns": lf.timestamp_ns,
                    "file_path": lf.file_path,
                    "topic": lf.topic,
                    "source_bag": bag_path.rstrip("/").split("/")[-1],
                    "lat": lf.lat,
                    "lon": lf.lon,
                }
                if isinstance(area, Circle):
                    row["distance_m"] = haversine(area.lat, area.lon, lf.lat, lf.lon)
                rows.append(row)

        rows.sort(key=lambda r: (r["bag_path"], r["timestamp_ns"]))
        rows = self._dedup_keep_earliest(rows)
        cap = self._cap if top_k is None else min(self._cap, int(top_k))
        return rows[:cap]

    def _dedup_keep_earliest(self, rows: list[dict]) -> list[dict]:
        """Per (bag, topic) sequence, collapse rows within the window to the earliest.
        Assumes `rows` is already sorted chronologically per bag."""
        if self._dedup_window_ns <= 0:
            return rows
        kept: list[dict] = []
        half = self._dedup_window_ns // 2
        for cand in rows:
            key = (cand["bag_path"], cand["topic"])
            ts = cand["timestamp_ns"]
            redundant = any(
                (s["bag_path"], s["topic"]) == key and abs(ts - s["timestamp_ns"]) <= half
                for s in kept
            )
            if not redundant:
                kept.append(cand)
        return kept
```

- [ ] **Step 4: Run to verify pass.** `PYTHONPATH="" uv run pytest tests/test_map_search_service.py -v` → PASS.
- [ ] **Step 5: Commit.**

```bash
git add src/services/map_search_service.py tests/test_map_search_service.py
git commit -m "[Backend] feat: MapSearchService.browse (dedup, chronological, distance, cap)"
```

## Task 2.2: Global compose — `area` prefilter on `GlobalSearcher`

**Files:**
- Modify: `src/retriever/global_search.py`
- Modify: `src/services/search_service.py`
- Test: `tests/test_global_search_area.py` (new)

- [ ] **Step 1: Write the failing test.** Create `tests/test_global_search_area.py`. It builds a real tiny LanceDB table + a v5 metadata.json, then asserts that an Area restricts the result set (and a small Area still returns its in-area best, not emptied).

```python
import json

import lancedb
import numpy as np
import pyarrow as pa

from src.core.app_config import get_app_config
from src.core.storage import resolve_artifact_path
from src.retriever.global_search import GlobalSearcher
from tests.fakes import FakeEmbedder


def _build_bag(tmp_path):
    cfg = get_app_config()
    bag = tmp_path / "bag"
    artifact = resolve_artifact_path(bag_path=bag)
    (artifact / "lancedb").mkdir(parents=True)
    dim = 4
    # 3 frames; frame 0 is inside the area, frames 1,2 outside.
    frames = [
        {"timestamp_ns": 1, "topic": "/c", "file_path": "f0.jpg", "lat": 45.0, "lon": 10.0},
        {"timestamp_ns": 2, "topic": "/c", "file_path": "f1.jpg", "lat": 48.0, "lon": 12.0},
        {"timestamp_ns": 3, "topic": "/c", "file_path": "f2.jpg", "lat": 48.1, "lon": 12.1},
    ]
    meta = {"schema_version": 5, "cameras": ["/c"],
            "embedder": {"name": "fake:test", "dim": dim}, "frames": frames}
    (artifact / "metadata.json").write_text(json.dumps(meta))

    # vectors: frame 1 is the best match for the query; frame 0 (in-area) is second.
    vecs = np.array([[0.9, 0.1, 0, 0], [1.0, 0, 0, 0], [0.0, 1.0, 0, 0]], dtype=np.float32)
    db = lancedb.connect(str(artifact / "lancedb"))
    db.create_table("frames", data=[
        {"timestamp_ns": frames[i]["timestamp_ns"], "topic": "/c",
         "file_path": frames[i]["file_path"], "vector": vecs[i].tolist()}
        for i in range(3)
    ], mode="overwrite")
    return cfg, str(bag)


def test_area_prefilters_global_search(tmp_path):
    cfg, bag = _build_bag(tmp_path)
    searcher = GlobalSearcher(config=cfg, embedder=FakeEmbedder(dim=4, name="fake:test"))
    q = [1.0, 0.0, 0.0, 0.0]  # closest to frame 1 (outside the area)

    area = {"kind": "circle", "center": {"lat": 45.0, "lon": 10.0}, "radius_m": 200}
    results = searcher._search_vector(query_vector=q, bag_paths=[bag], top_k=5, area=area)

    # Only the in-area frame survives the prefilter.
    assert {r["file_path"] for r in results} == {"f0.jpg"}


def test_no_area_returns_all(tmp_path):
    cfg, bag = _build_bag(tmp_path)
    searcher = GlobalSearcher(config=cfg, embedder=FakeEmbedder(dim=4, name="fake:test"))
    results = searcher._search_vector(query_vector=[1.0, 0, 0, 0], bag_paths=[bag], top_k=5)
    assert len(results) == 3
```

- [ ] **Step 2: Run to verify failure.** `PYTHONPATH="" uv run pytest tests/test_global_search_area.py -v` → FAIL (`_search_vector` has no `area` kwarg).

- [ ] **Step 3: Implement the prefilter.** In `src/retriever/global_search.py`:

  a. Add imports:

```python
from src.geo.area import area_from_payload
from src.geo.locator import resolve_area_to_frames
```

  b. Change `_search_vector`'s signature to accept `area`:

```python
    def _search_vector(
        self,
        query_vector: list[float],
        bag_paths: List[str],
        top_k: int,
        exclude_file_path: str | None = None,
        area: dict | None = None,
    ) -> list[dict]:
```

  c. Near the top of `_search_vector`, resolve the Area once (before the bag loop):

```python
        area_obj = area_from_payload(area)
        in_area: dict[str, set[str]] | None = None
        if area_obj is not None:
            in_area = {
                bp: {lf.file_path for lf in located}
                for bp, located in resolve_area_to_frames(area_obj, bag_paths).items()
            }
```

  d. Inside the per-bag loop, after `table = db.open_table("frames")`, build the query and apply the prefilter. Replace the existing `results = table.search(...)...` line with:

```python
            query = table.search(query_vector).metric("cosine")
            if in_area is not None:
                allowed = in_area.get(bag_path, set())
                if not allowed:
                    continue  # bag has no in-area frames
                clause = "file_path IN (" + ", ".join("'" + fp + "'" for fp in allowed) + ")"
                query = query.where(clause, prefilter=True)
            results = query.limit(fetch_limit).to_list()
```

  e. Thread `area` through the three public methods. Change their signatures and the `_search_vector` calls:

```python
    def search(self, query: str, bag_paths: List[str], top_k: int = 5, area: dict | None = None):
        logger.info("Embedding query: '%s'", query)
        query_vector = self._embedder.embed_text([query])[0].tolist()
        return self._search_vector(query_vector=query_vector, bag_paths=bag_paths, top_k=top_k, area=area)

    def search_by_image_bytes(self, image_bytes: bytes, bag_paths: List[str], top_k: int = 5, area: dict | None = None):
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        query_vector = self._embedder.embed_images([image])[0].tolist()
        return self._search_vector(query_vector=query_vector, bag_paths=bag_paths, top_k=top_k, area=area)

    def search_similar_by_file_path(self, file_path: str, bag_paths: List[str], top_k: int = 5, area: dict | None = None):
        image_path = Path(file_path).expanduser().resolve()
        image = Image.open(image_path).convert("RGB")
        query_vector = self._embedder.embed_images([image])[0].tolist()
        return self._search_vector(
            query_vector=query_vector, bag_paths=bag_paths, top_k=top_k,
            exclude_file_path=str(image_path), area=area,
        )
```

  Note: `_compatible_bags` keys by the same `bag_path` strings passed in, so `in_area.get(bag_path, …)` lines up with the loop variable.

- [ ] **Step 4: Thread `area` through `SearchService`.** In `src/services/search_service.py`, add an optional `area` to each method and forward it:

```python
    def search(self, query: str, bag_paths: list[str], top_k: int, area: dict | None = None) -> list[dict]:
        if not bag_paths:
            raise ValueError("Must provide at least one bag path.")
        return self._searcher.search(query=query, bag_paths=bag_paths, top_k=top_k, area=area)

    def search_by_image(self, image_bytes: bytes, bag_paths: list[str], top_k: int, area: dict | None = None) -> list[dict]:
        if not bag_paths:
            raise ValueError("Must provide at least one bag path.")
        if not image_bytes:
            raise ValueError("Image payload is empty.")
        return self._searcher.search_by_image_bytes(image_bytes=image_bytes, bag_paths=bag_paths, top_k=top_k, area=area)

    def search_similar(self, file_path: str, bag_paths: list[str], top_k: int, area: dict | None = None) -> list[dict]:
        if not bag_paths:
            raise ValueError("Must provide at least one bag path.")
        if not file_path.strip():
            raise ValueError("file_path must not be empty.")
        return self._searcher.search_similar_by_file_path(file_path=file_path, bag_paths=bag_paths, top_k=top_k, area=area)
```

- [ ] **Step 5: Run to verify pass.** `PYTHONPATH="" uv run pytest tests/test_global_search_area.py -v` → PASS. Also `PYTHONPATH="" uv run pytest tests/test_temporal_dedup.py tests/test_global_search_compat.py -v` (unchanged behavior).
- [ ] **Step 6: Commit.**

```bash
git add src/retriever/global_search.py src/services/search_service.py tests/test_global_search_area.py
git commit -m "[Backend] feat: Global search composes with Area (LanceDB IN-list prefilter)"
```

## Task 2.3: API — Area models, `area` on search endpoints, `POST /api/search/map`

**Files:**
- Modify: `src/api/search_routes.py`
- Modify: `src/api/dependencies.py`
- Modify: `src/services/component_factory.py`
- Test: `tests/test_map_api.py` (new)

- [ ] **Step 1: Write the failing tests.** Create `tests/test_map_api.py` (Idiom B — `bypass_auth` + dependency override, per `tests/test_region_api.py`):

```python
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.api.dependencies import get_map_search_service, get_search_service
from src.api.search_routes import router as search_router


class _MapStub:
    def __init__(self):
        self.calls = []

    def browse(self, area_payload, bag_paths, top_k=None):
        self.calls.append((area_payload, bag_paths, top_k))
        return [{"bag_path": bag_paths[0], "timestamp_ns": 1, "file_path": "f.jpg",
                 "topic": "/c", "source_bag": "b", "lat": 45.0, "lon": 10.0, "distance_m": 12.0}]


class _SearchStub:
    def __init__(self):
        self.area = "UNSET"

    def search(self, query, bag_paths, top_k, area=None):
        self.area = area
        return [{"bag_path": bag_paths[0], "timestamp_ns": 1, "file_path": "f.jpg",
                 "topic": "/c", "similarity_score": 0.9, "source_bag": "b"}]


def _client(bypass_auth, *, map_stub=None, search_stub=None):
    app = FastAPI()
    app.include_router(search_router)
    bypass_auth(app)
    if map_stub is not None:
        app.dependency_overrides[get_map_search_service] = lambda: map_stub
    if search_stub is not None:
        app.dependency_overrides[get_search_service] = lambda: search_stub
    return TestClient(app)


CIRCLE = {"kind": "circle", "center": {"lat": 45.0, "lon": 10.0}, "radius_m": 120}


def test_map_browse_endpoint(bypass_auth):
    stub = _MapStub()
    resp = _client(bypass_auth, map_stub=stub).post(
        "/api/search/map", json={"area": CIRCLE, "bag_paths": ["/b"], "top_k": 50})
    assert resp.status_code == 200
    assert resp.json()["results"][0]["distance_m"] == 12.0
    assert stub.calls[0][1] == ["/b"]


def test_map_browse_rejects_bad_polygon(bypass_auth):
    resp = _client(bypass_auth, map_stub=_MapStub()).post(
        "/api/search/map",
        json={"area": {"kind": "polygon", "vertices": [{"lat": 0, "lon": 0}]}, "bag_paths": ["/b"]})
    assert resp.status_code == 422  # < 3 vertices


def test_area_forwarded_on_global_search(bypass_auth):
    stub = _SearchStub()
    resp = _client(bypass_auth, search_stub=stub).post(
        "/api/search", json={"query": "car", "bag_paths": ["/b"], "top_k": 5, "area": CIRCLE})
    assert resp.status_code == 200
    assert stub.area == CIRCLE


def test_area_absent_is_none(bypass_auth):
    stub = _SearchStub()
    _client(bypass_auth, search_stub=stub).post(
        "/api/search", json={"query": "car", "bag_paths": ["/b"], "top_k": 5})
    assert stub.area is None
```

- [ ] **Step 2: Run to verify failure.** `PYTHONPATH="" uv run pytest tests/test_map_api.py -v` → FAIL (`ImportError: get_map_search_service`).

- [ ] **Step 3: Add Area models + thread `area` + new route** in `src/api/search_routes.py`:

  a. Extend imports at the top:

```python
from typing import List, Optional, Union
from typing import Annotated, Literal
...
from src.api.dependencies import (
    get_map_search_service, get_region_search_service, get_search_service,
)
from src.services.map_search_service import MapSearchService
```

  b. Add the discriminated Area union after the existing `Point` model:

```python
class LatLon(BaseModel):
    lat: float = Field(..., ge=-90.0, le=90.0)
    lon: float = Field(..., ge=-180.0, le=180.0)


class CircleArea(BaseModel):
    kind: Literal["circle"]
    center: LatLon
    radius_m: float = Field(..., gt=0.0)


class PolygonArea(BaseModel):
    kind: Literal["polygon"]
    vertices: List[LatLon] = Field(..., min_length=3)


Area = Annotated[Union[CircleArea, PolygonArea], Field(discriminator="kind")]


class MapSearchRequest(BaseModel):
    area: Area
    bag_paths: List[str]
    top_k: Optional[int] = Field(default=None, ge=1, le=2000)
```

  c. Add `area: Optional[Area] = None` to `SearchRequest`, `SimilarSearchRequest`, `RegionByTextRequest`, `RegionByFrameRequest` (one line each in those models).

  d. In `search_bags`, `search_similar_images`, forward the area (`req.area.model_dump() if req.area else None`):

```python
        results = search_service.search(
            query=req.query, bag_paths=req.bag_paths, top_k=req.top_k,
            area=req.area.model_dump() if req.area else None,
        )
```
  (and the analogous `search_similar(..., area=req.area.model_dump() if req.area else None)`).

  e. In `search_bags_by_image` (multipart), add `area: Optional[str] = Form(default=None)` to the signature and parse it:

```python
        import json as _json
        parsed_area = _json.loads(area) if area else None
        results = search_service.search_by_image(
            image_bytes=image_bytes, bag_paths=bag_paths, top_k=top_k, area=parsed_area,
        )
```

  f. Add the new browse route (anywhere among the search routes):

```python
@router.post("/search/map")
async def search_map(
    req: MapSearchRequest,
    service: Annotated[MapSearchService, Depends(get_map_search_service)],
):
    """Standalone Map browse: chronological, temporal-deduped in-area Frames."""
    try:
        results = service.browse(
            area_payload=req.area.model_dump(), bag_paths=req.bag_paths, top_k=req.top_k,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"query": "map", "results": results}
```

- [ ] **Step 4: Add the factory method + dependency.** In `src/services/component_factory.py` add the import `from src.services.map_search_service import MapSearchService` and a method:

```python
    def create_map_search_service(self) -> MapSearchService:
        return MapSearchService(config=self._config)
```

In `src/api/dependencies.py` add the import `from src.services.map_search_service import MapSearchService` and:

```python
def get_map_search_service(request: Request) -> MapSearchService:
    return request.app.state.component_factory.create_map_search_service()
```

(No capability gate — spec §5.3. No `app.state` change needed: the factory builds it per request, like nothing heavy is held.)

- [ ] **Step 5: Run to verify pass.** `PYTHONPATH="" uv run pytest tests/test_map_api.py tests/test_region_api.py tests/test_api_contracts.py -v` → PASS (the last two confirm existing endpoints still pass with the new optional `area` field).
- [ ] **Step 6: Commit.**

```bash
git add src/api/search_routes.py src/api/dependencies.py src/services/component_factory.py tests/test_map_api.py
git commit -m "[API] feat: Area request models, area on search endpoints, POST /api/search/map"
```

## Task 2.4: `is_located` on scan/info + `GET /api/bags/track`

**Files:**
- Modify: `src/api/bags.py`
- Modify: `tests/test_auth_enforcement.py`
- Test: `tests/test_bags_track.py` (new)

- [ ] **Step 1: Write the failing tests.** Create `tests/test_bags_track.py`:

```python
import json

from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.api.bags import router as bags_router
from src.core.app_config import get_app_config
from src.core.storage import resolve_artifact_path


def _bag(tmp_path):
    bag = tmp_path / "bag"
    artifact = resolve_artifact_path(bag_path=bag)
    (artifact / "lancedb").mkdir(parents=True)
    frames = [
        {"timestamp_ns": 1, "topic": "/c", "file_path": "f1.jpg", "lat": 45.0, "lon": 10.0},
        {"timestamp_ns": 2, "topic": "/c", "file_path": "f2.jpg"},  # unlocated
        {"timestamp_ns": 3, "topic": "/c", "file_path": "f3.jpg", "lat": 45.1, "lon": 10.1},
    ]
    meta = {"schema_version": 5, "frames": frames,
            "gps": {"topic": "/oxts/nav_sat_fix", "max_gap_sec": 1.0,
                    "fix_count": 9, "located_frame_count": 2, "frame_count": 3}}
    (artifact / "metadata.json").write_text(json.dumps(meta))
    return str(bag)


def _client(bypass_auth):
    app = FastAPI()
    app.include_router(bags_router)
    bypass_auth(app)
    return TestClient(app)


def test_track_returns_located_points_only(tmp_path, bypass_auth):
    bag = _bag(tmp_path)
    resp = _client(bypass_auth).get(f"/api/bags/track?bag_path={bag}")
    assert resp.status_code == 200
    pts = resp.json()["points"]
    assert len(pts) == 2
    assert pts[0] == {"lat": 45.0, "lon": 10.0, "timestamp_ns": 1}


def test_track_stride(tmp_path, bypass_auth):
    bag = _bag(tmp_path)
    resp = _client(bypass_auth).get(f"/api/bags/track?bag_path={bag}&stride=2")
    assert [p["timestamp_ns"] for p in resp.json()["points"]] == [1]


def test_info_reports_is_located(tmp_path, bypass_auth):
    bag = _bag(tmp_path)
    resp = _client(bypass_auth).get(f"/api/bags/info?bag_path={bag}")
    body = resp.json()
    assert body["is_located"] is True
    assert body["located_frame_count"] == 2
```

- [ ] **Step 2: Run to verify failure.** `PYTHONPATH="" uv run pytest tests/test_bags_track.py -v` → FAIL (no `/track`; `is_located` missing).

- [ ] **Step 3: Implement.** In `src/api/bags.py`:

  a. Add the import: `from src.core.index_stamp import gps_is_located, read_gps_stamp`.

  b. In `scan_bags`, when appending each bag dict, derive `is_located` from the bag's metadata (scan does not load metadata today — read the stamp cheaply):

```python
        stamp = read_gps_stamp(_metadata_path_for_bag(candidate))
        bags.append(
            {
                "bag_path": bag_path,
                "bag_name": candidate.name,
                "is_indexed": lancedb_dir.exists() and lancedb_dir.is_dir(),
                "status": indexing_status.get(bag_path, "idle"),
                "is_located": gps_is_located(stamp),
                "located_frame_count": int(stamp.get("located_frame_count", 0)) if stamp else 0,
            }
        )
```

  c. In `bag_info` (which already loads `metadata`), extend the return dict:

```python
    gps_stamp = metadata.get("gps")
    return {
        "bag_path": str(path),
        "frame_count": len(timestamps),
        "first_timestamp_ns": min(timestamps) if timestamps else None,
        "last_timestamp_ns": max(timestamps) if timestamps else None,
        "is_located": gps_is_located(gps_stamp),
        "located_frame_count": int(gps_stamp.get("located_frame_count", 0)) if gps_stamp else 0,
    }
```

  d. Add the new `track` route modeled on `bag_frames`:

```python
@router.get("/track")
async def bag_track(
    bag_path: str = Query(..., description="Absolute path of bag directory"),
    stride: int = Query(1, ge=1, description="Return every Nth located frame"),
):
    """The bag's trajectory: located frames as {lat, lon, timestamp_ns}, chronological."""
    path = Path(bag_path).expanduser().resolve()
    if not path.exists() or not path.is_dir():
        raise HTTPException(status_code=404, detail="Bag path does not exist")

    metadata_path = _metadata_path_for_bag(path)
    if not metadata_path.exists() or not metadata_path.is_file():
        raise HTTPException(status_code=404, detail="Bag metadata not found. Index the bag first.")

    with metadata_path.open("r", encoding="utf-8") as handle:
        metadata = json.load(handle)

    located = [
        {"lat": f["lat"], "lon": f["lon"], "timestamp_ns": f["timestamp_ns"]}
        for f in metadata.get("frames", [])
        if "lat" in f and "lon" in f
    ]
    located.sort(key=lambda p: p["timestamp_ns"])
    return {"bag_path": str(path), "points": located[::stride]}
```

- [ ] **Step 4: Add the auth-enforcement row.** In `tests/test_auth_enforcement.py`, add a parametrize entry asserting the new endpoint is authed (it sits on the already-authed `bags_router`, so this passes for free):

```python
        (bags_router, "GET", "/api/bags/track?bag_path=/tmp/x"),
```

- [ ] **Step 5: Run to verify pass.** `PYTHONPATH="" uv run pytest tests/test_bags_track.py tests/test_auth_enforcement.py -v` → the new tests PASS and the new auth row PASS. (The pre-existing `image_router` 400-vs-401 failure is the known unrelated gap — leave it.)
- [ ] **Step 6: Commit.**

```bash
git add src/api/bags.py tests/test_bags_track.py tests/test_auth_enforcement.py
git commit -m "[API] feat: GET /api/bags/track + is_located/located_frame_count on scan & info"
```

---

# SLICE 3 — Region compose

## Task 3.1: `FaissPatchIndex.search` — `allowed_frame_ids` via `IDSelector` + exhaustive nprobe

**Files:**
- Modify: `src/region/faiss_index.py`
- Test: `tests/test_faiss_area_selector.py` (new)

**Decision (spike-validated):** when `allowed_frame_ids` is given, build an `IDSelectorBatch` over the patch rows whose frame is allowed, and search with `SearchParametersIVF.nprobe = nlist` (exhaustive) for IVF indexes — this restores small-Area recall to ~1.0 at ~6–41 ms because the selector bounds the work. For `IndexFlatIP` (small bags), pass the selector via `SearchParameters` (nprobe is irrelevant).

- [ ] **Step 1: Write the failing test.** Create `tests/test_faiss_area_selector.py` (uses the FlatIP path — `min_patches_for_pq=10_000` → tiny index is exact, so the assertion is deterministic):

```python
import numpy as np

from src.region.faiss_index import FaissPatchIndex


def _unit(dim, i):
    v = np.zeros(dim, dtype=np.float32)
    v[i] = 1.0
    return v


def test_selector_restricts_results_to_allowed_frames():
    dim = 8
    # 3 frames, 2 patches each. frame f's patches point at basis vector f.
    vecs, frame_ids = [], []
    for f in range(3):
        for _ in range(2):
            vecs.append(_unit(dim, f))
            frame_ids.append(f)
    idx = FaissPatchIndex(dim=dim, min_patches_for_pq=10_000)  # tiny -> IndexFlatIP
    idx.train_add(np.stack(vecs), np.asarray(frame_ids, dtype=np.int32))

    q = _unit(dim, 1)  # best match is frame 1
    # Unrestricted: frame 1 wins.
    fids, _ = idx.search(q, k=6)
    assert 1 in set(fids.tolist())
    # Restricted to frames {0, 2}: frame 1 must NOT appear.
    fids2, _ = idx.search(q, k=6, allowed_frame_ids={0, 2})
    assert set(fids2.tolist()).issubset({0, 2})
    assert fids2.size > 0


def test_empty_allowed_returns_empty():
    dim = 4
    idx = FaissPatchIndex(dim=dim, min_patches_for_pq=10_000)
    idx.train_add(np.stack([_unit(dim, 0), _unit(dim, 1)]), np.asarray([0, 1], dtype=np.int32))
    fids, scores = idx.search(_unit(dim, 0), k=2, allowed_frame_ids=set())
    assert fids.size == 0 and scores.size == 0
```

- [ ] **Step 2: Run to verify failure.** `PYTHONPATH="" uv run pytest tests/test_faiss_area_selector.py -v` → FAIL (`search` has no `allowed_frame_ids`).

- [ ] **Step 3: Implement.** In `src/region/faiss_index.py`, replace the `search` method with:

```python
    def search(self, q: np.ndarray, k: int, *, allowed_frame_ids=None) -> tuple[np.ndarray, np.ndarray]:
        assert self._index is not None and self._patch_frames is not None, "index not built/loaded"
        q = np.ascontiguousarray(q.reshape(1, -1), dtype=np.float32)

        params = None
        if allowed_frame_ids is not None:
            allowed = np.fromiter((int(f) for f in allowed_frame_ids), dtype=np.int32)
            if allowed.size == 0:
                return np.empty(0, dtype=np.int32), np.empty(0, dtype=np.float32)
            rows = np.where(np.isin(np.asarray(self._patch_frames), allowed))[0].astype(np.int64)
            if rows.size == 0:
                return np.empty(0, dtype=np.int32), np.empty(0, dtype=np.float32)
            self._selector_rows = rows  # keep a reference alive for the C++ selector
            selector = faiss.IDSelectorBatch(rows)
            if isinstance(self._index, faiss.IndexIVF):
                params = faiss.SearchParametersIVF()
                params.nprobe = self._index.nlist  # exhaustive: restores small-Area recall (spike 2026-06-03)
                params.sel = selector
            else:
                params = faiss.SearchParameters()
                params.sel = selector

        k = min(int(k), self._index.ntotal)
        if params is not None:
            scores, rows_out = self._index.search(q, k, params=params)
        else:
            scores, rows_out = self._index.search(q, k)
        rows_out = rows_out[0]
        scores = scores[0]
        valid = rows_out >= 0
        rows_out = rows_out[valid]
        scores = scores[valid]
        frame_ids = np.asarray(self._patch_frames)[rows_out].astype(np.int32)
        return frame_ids, scores.astype(np.float32)
```

- [ ] **Step 4: Run to verify pass.** `PYTHONPATH="" uv run pytest tests/test_faiss_area_selector.py tests/test_region_index.py -v` → PASS (the latter confirms the unchanged no-selector path still works).
- [ ] **Step 5: Commit.**

```bash
git add src/region/faiss_index.py tests/test_faiss_area_selector.py
git commit -m "[Backend] feat: FaissPatchIndex.search allowed_frame_ids (IDSelector + exhaustive nprobe)"
```

## Task 3.2: `area` on `RegionSearcher` / `RegionSearchService` / region routes

**Files:**
- Modify: `src/region/region_search.py`
- Modify: `src/services/region_search_service.py`
- Modify: `src/api/search_routes.py`
- Test: `tests/test_region_search_area.py` (new)

- [ ] **Step 1: Write the failing test.** Create `tests/test_region_search_area.py` (reuses the `_make_region_bag` factory shape from `tests/test_region_search.py`):

```python
import json

import numpy as np

from src.core.app_config import get_app_config
from src.region.faiss_index import FaissPatchIndex
from src.region.region_search import RegionSearcher
from tests.fakes import FakeDenseEmbedder


def _unit(dim, i):
    v = np.zeros(dim, dtype=np.float32)
    v[i] = 1.0
    return v


def _make_bag(tmp_path, frames, patch_vecs_per_frame, dim):
    bag = tmp_path / "bag"
    artifact = bag / ".bag_chat"
    region = artifact / "region"
    region.mkdir(parents=True)
    vecs, frame_ids = [], []
    for fid, pv in enumerate(patch_vecs_per_frame):
        vecs.append(pv.astype(np.float32))
        frame_ids.extend([fid] * pv.shape[0])
    idx = FaissPatchIndex(dim=dim, min_patches_for_pq=10_000)
    idx.train_add(np.concatenate(vecs), np.asarray(frame_ids, dtype=np.int32))
    idx.persist(region)
    meta = {
        "schema_version": 5, "cameras": ["/c"],
        "embedder": {"name": "fake-dense:test", "dim": dim},
        "region_index": {"engine": "faiss", "embedder_name": "fake-dense:test", "dim": dim,
                         "feature": "value-attention", "encode_long_side": 56,
                         "pq": {"m": 64, "nbits": 8}, "patch_count": len(frame_ids)},
        "frames": frames,
    }
    (artifact / "metadata.json").write_text(json.dumps(meta))
    return str(bag)


def test_region_search_area_restricts_to_in_area_frames(tmp_path):
    dim = 8
    frames = [
        {"timestamp_ns": 1, "topic": "/c", "file_path": "f0.jpg", "lat": 45.0, "lon": 10.0},  # inside
        {"timestamp_ns": 2, "topic": "/c", "file_path": "f1.jpg", "lat": 48.0, "lon": 12.0},  # outside
    ]
    # frame 1 (outside) is the best match for the query basis vector 1.
    bag = _make_bag(tmp_path, frames, [np.stack([_unit(dim, 0)]), np.stack([_unit(dim, 1)])], dim)
    searcher = RegionSearcher(config=get_app_config(), embedder=FakeDenseEmbedder(dim=dim))
    q = _unit(dim, 1)
    area = {"kind": "circle", "center": {"lat": 45.0, "lon": 10.0}, "radius_m": 200}
    results = searcher.search_by_q(q, [bag], top_k=5, area=area)
    assert {r["file_path"] for r in results} == {"f0.jpg"}  # outside frame excluded
```

- [ ] **Step 2: Run to verify failure.** `PYTHONPATH="" uv run pytest tests/test_region_search_area.py -v` → FAIL (`search_by_q` has no `area`).

- [ ] **Step 3: Implement.** In `src/region/region_search.py`:

  a. Add imports: `from src.geo.area import area_from_payload` and `from src.geo.locator import frames_in_area`.

  b. Change `search_by_q` to accept `area` and compute the per-bag allowed frame set, passing it to `index.search`:

```python
    def search_by_q(
        self, q: np.ndarray, bag_paths: List[str], top_k: int = 5,
        exclude_file_path: str | None = None, area: dict | None = None,
    ) -> list[dict]:
        exclude_path = str(Path(exclude_file_path).expanduser().resolve()) if exclude_file_path else None
        top_k_patches = max(1, self._cfg.top_k_patches)
        area_obj = area_from_payload(area)
        all_results: list[dict] = []

        for bag_path, artifact, frames in self._compatible_region_bags(bag_paths):
            index = self._get_index(artifact / "region")
            allowed_frame_ids = None
            if area_obj is not None:
                allowed_frame_ids = set(frames_in_area(area_obj, frames))
                if not allowed_frame_ids:
                    continue  # no in-area frames in this bag
            frame_ids, scores = index.search(
                q, self._cfg.patch_fetch_limit, allowed_frame_ids=allowed_frame_ids,
            )
            if frame_ids.size == 0:
                continue
            # ... rest of the loop body (per_frame grouping etc.) unchanged ...
```

  c. Thread `area` through the two callers:

```python
    def search_by_points(self, image, points, bag_paths, top_k=5, exclude_file_path=None, area=None):
        q = build_query_from_points(image, points, self._embedder)
        return self.search_by_q(q, bag_paths, top_k, exclude_file_path, area=area)

    def search_by_text(self, text, bag_paths, top_k=5, area=None):
        q = build_query_from_text(text, self._embedder, self._cfg.text_templates)
        return self.search_by_q(q, bag_paths, top_k, area=area)
```

- [ ] **Step 4: Thread `area` through `RegionSearchService`.** In `src/services/region_search_service.py`, add `area: dict | None = None` to `search_by_text`, `search_by_frame`, `search_by_image` and forward to the searcher (`area=area`). Leave the `heatmap_*` methods unchanged.

- [ ] **Step 5: Thread `area` through the region routes.** In `src/api/search_routes.py`:
  - `region_search_by_text`: `area=req.area.model_dump() if req.area else None`.
  - `region_search_by_frame`: same.
  - `region_search_by_image` (multipart): add `area: Optional[str] = Form(default=None)`, then `parsed_area = _json.loads(area) if area else None` and pass `area=parsed_area`.

- [ ] **Step 6: Run to verify pass.** `PYTHONPATH="" uv run pytest tests/test_region_search_area.py tests/test_region_search.py tests/test_region_api.py -v` → PASS.
- [ ] **Step 7: Commit.**

```bash
git add src/region/region_search.py src/services/region_search_service.py src/api/search_routes.py tests/test_region_search_area.py
git commit -m "[Backend] feat: Region search composes with Area (IDSelector + exhaustive nprobe)"
```

## Task 3.3: Full backend suite + real-bag e2e

- [ ] **Step 1: Run the full suite.** `PYTHONPATH="" uv run pytest tests/ -v`. Expected: all green except the one pre-existing `test_auth_enforcement` image-router 400-vs-401 case (documented gap — do not fix here).
- [ ] **Step 2: Real-bag e2e (manual).** Re-index both real bags so they carry v5 + GPS, then sanity-check browse + compose end to end:

```bash
# Re-extract + re-index both bags (extraction now reads GPS; build_index re-embeds).
PYTHONPATH="" uv run python -c "
from src.services.indexing_service import IndexingService
from src.services.component_factory import BackendComponentFactory
from src.core.app_config import get_app_config
from src.embedding import create_embedder
cfg = get_app_config(); emb = create_embedder(cfg)
f = BackendComponentFactory(config=cfg, embedder=emb)
svc = IndexingService(factory=f, status_store={})
for b in ['/home/paolopertino/adehome/aida_code/bags/2025-10-23_15-42',
          '/home/paolopertino/adehome/aida_code/bags/2026-01-21_09-53']:
    svc.index_bag(b)
print('done')
"
```

Then start the server (`JWT_SECRET=x REFRESH_SECRET=y uv run uvicorn app:app`) and confirm via an authed client that `POST /api/search/map` with a circle near a known intersection returns frames, and `POST /api/search` with the same `area` narrows global results. Record findings in the PR description. **This is the gate the spec flagged as "pending real-bag e2e."**
- [ ] **Step 3: Commit** any metadata/test adjustments surfaced (e.g. a literal `schema_version` bump in a test).

```bash
git commit -am "[Backend] chore: backend Map search e2e validated on real bags"
```

---

# SLICE 4 — Frontend map

No frontend unit-test harness exists. Each task gates on `cd frontend && npm run lint` (`eslint .`) and `npm run build` (`tsc -b && vite build` — type errors fail) plus the manual checks noted. Commit after each task.

## Task 4.1: Install map dependencies

**Files:** Modify `frontend/package.json` (+ lockfile).

- [ ] **Step 1:** Install React-19-compatible versions (react-leaflet v5 line):

```bash
cd frontend && npm install leaflet@^1.9 react-leaflet@^5 @geoman-io/leaflet-geoman-free@^2.18 leaflet.markercluster@^1.5 \
  && npm install -D @types/leaflet @types/leaflet.markercluster
```

- [ ] **Step 2:** `npm run build` → PASS (deps resolve, no type break).
- [ ] **Step 3: Commit.**

```bash
git add frontend/package.json frontend/package-lock.json
git commit -m "[UI] chore: add leaflet, react-leaflet, geoman, markercluster"
```

## Task 4.2: Wire types + Area URL codec + TS point-in-area

**Files:** Modify `frontend/src/api/types.ts`; create `frontend/src/lib/area-codec.ts`, `frontend/src/lib/area-geo.ts`.

- [ ] **Step 1: Extend `types.ts`.** Add to `SearchResult` (optional, browse rows omit score / add geo):

```ts
export interface SearchResult {
  bag_path: string;
  timestamp_ns: number;
  file_path: string;
  topic: string;
  similarity_score?: number;   // absent for Map browse rows
  source_bag: string;
  lat?: number;
  lon?: number;
  distance_m?: number;
}
```

Add `is_located` / `located_frame_count` to `BagInfo`:

```ts
export interface BagInfo {
  bag_path: string;
  bag_name: string;
  is_indexed: boolean;
  status: BagStatus;
  error_message?: string | null;
  is_located?: boolean;
  located_frame_count?: number;
}
```

Add new wire/value types near `Point`:

```ts
export interface LatLon { lat: number; lon: number; }
export type Area =
  | { kind: "circle"; center: LatLon; radius_m: number }
  | { kind: "polygon"; vertices: LatLon[] };

export interface TrackPoint { lat: number; lon: number; timestamp_ns: number; }
export interface TrackResponse { bag_path: string; points: TrackPoint[]; }
```

Note: `similarity_score` becomes optional — update any consumer that reads it. In `search.tsx` the region filter uses `r.similarity_score >= search.minScore`; guard with `(r.similarity_score ?? 1) >= search.minScore` (Task 4.6).

- [ ] **Step 2: Create `frontend/src/lib/area-codec.ts`** — compact URL encode/decode for the `?area=` param:

```ts
import type { Area } from "../api/types";

// circle:LAT,LON,RADIUS   |   poly:LAT,LON;LAT,LON;...
export function encodeArea(area: Area): string {
  if (area.kind === "circle") {
    return `circle:${area.center.lat},${area.center.lon},${area.radius_m}`;
  }
  return "poly:" + area.vertices.map((v) => `${v.lat},${v.lon}`).join(";");
}

export function decodeArea(raw: string | null): Area | null {
  if (!raw) return null;
  try {
    if (raw.startsWith("circle:")) {
      const [lat, lon, r] = raw.slice(7).split(",").map(Number);
      if ([lat, lon, r].some((n) => !Number.isFinite(n)) || r <= 0) return null;
      return { kind: "circle", center: { lat, lon }, radius_m: r };
    }
    if (raw.startsWith("poly:")) {
      const vertices = raw.slice(5).split(";").map((pair) => {
        const [lat, lon] = pair.split(",").map(Number);
        return { lat, lon };
      });
      if (vertices.length < 3 || vertices.some((v) => !Number.isFinite(v.lat) || !Number.isFinite(v.lon)))
        return null;
      return { kind: "polygon", vertices };
    }
  } catch {
    return null;
  }
  return null;
}
```

- [ ] **Step 3: Create `frontend/src/lib/area-geo.ts`** — client-side containment for the live count (mirrors `src/geo/area.py`):

```ts
import type { Area, TrackPoint } from "../api/types";

const EARTH_RADIUS_M = 6_371_000;

function haversine(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const p1 = (aLat * Math.PI) / 180;
  const p2 = (bLat * Math.PI) / 180;
  const dPhi = ((bLat - aLat) * Math.PI) / 180;
  const dLmb = ((bLon - aLon) * Math.PI) / 180;
  const h = Math.sin(dPhi / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dLmb / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

function pointInPolygon(lat: number, lon: number, verts: { lat: number; lon: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
    const yi = verts[i].lat, xi = verts[i].lon, yj = verts[j].lat, xj = verts[j].lon;
    if ((yi > lat) !== (yj > lat)) {
      const xCross = ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
      if (lon < xCross) inside = !inside;
    }
  }
  return inside;
}

export function areaContains(area: Area, lat: number, lon: number): boolean {
  if (area.kind === "circle") {
    return haversine(area.center.lat, area.center.lon, lat, lon) <= area.radius_m;
  }
  return pointInPolygon(lat, lon, area.vertices);
}

export function countInArea(area: Area, tracks: TrackPoint[][]): number {
  let n = 0;
  for (const track of tracks) for (const p of track) if (areaContains(area, p.lat, p.lon)) n++;
  return n;
}
```

- [ ] **Step 4: Verify.** `cd frontend && npm run lint && npm run build` → PASS.
- [ ] **Step 5: Commit.**

```bash
git add frontend/src/api/types.ts frontend/src/lib/area-codec.ts frontend/src/lib/area-geo.ts
git commit -m "[UI] feat: Area types, URL codec, client-side point-in-area"
```

## Task 4.3: API client — `getTrack`, `searchMap`, thread `area`

**Files:** Modify `frontend/src/api/client.ts`.

- [ ] **Step 1: Add `area` to request interfaces + global calls.** Update `SearchRequest`/`SimilarSearchRequest` to include `area?: Area;`, import `Area`, `TrackResponse`, `SearchResponse` from `./types`. Thread `area` into `search`/`searchSimilar` (already JSON body — just include it) and `searchByImage` (`if (area) formData.append("area", JSON.stringify(area));`). Likewise add an `area?: Area` parameter to `regionSearchByText`/`regionSearchByFrame`/`regionSearchByImage` and send it (JSON body or `formData.append("area", JSON.stringify(area))`).

- [ ] **Step 2: Add new calls** near `getFrames`:

```ts
export async function getTrack(bagPath: string, stride = 1): Promise<TrackResponse> {
  const params = new URLSearchParams({ bag_path: bagPath, stride: String(stride) });
  return http<TrackResponse>(`/api/bags/track?${params.toString()}`);
}

export async function searchMap(
  area: Area,
  bagPaths: string[],
  topK?: number,
): Promise<SearchResponse> {
  return http<SearchResponse>("/api/search/map", {
    method: "POST",
    body: JSON.stringify({ area, bag_paths: bagPaths, ...(topK ? { top_k: topK } : {}) }),
  });
}
```

- [ ] **Step 3: Verify.** `npm run lint && npm run build` → PASS.
- [ ] **Step 4: Commit.**

```bash
git add frontend/src/api/client.ts
git commit -m "[UI] feat: client getTrack/searchMap + area threaded into search calls"
```

## Task 4.4: Hooks — `use-bag-tracks`, `use-map-area`

**Files:** Create `frontend/src/hooks/use-bag-tracks.ts`, `frontend/src/hooks/use-map-area.ts`.

- [ ] **Step 1: `use-bag-tracks.ts`** — fetch + cache trajectories for the selected bags (mirrors the thin-wrapper style of `use-region-search.ts`):

```ts
import { useCallback, useEffect, useRef, useState } from "react";

import { getTrack } from "../api/client";
import type { TrackPoint } from "../api/types";

export function useBagTracks(bagPaths: string[]) {
  const [tracks, setTracks] = useState<Record<string, TrackPoint[]>>({});
  const [loading, setLoading] = useState(false);
  const cacheRef = useRef<Record<string, TrackPoint[]>>({});

  const key = bagPaths.join(",");
  useEffect(() => {
    let cancelled = false;
    const missing = bagPaths.filter((b) => !(b in cacheRef.current));
    if (missing.length === 0) {
      setTracks({ ...cacheRef.current });
      return;
    }
    setLoading(true);
    Promise.all(missing.map((b) => getTrack(b).then((r) => [b, r.points] as const).catch(() => [b, []] as const)))
      .then((entries) => {
        if (cancelled) return;
        for (const [b, pts] of entries) cacheRef.current[b] = pts;
        setTracks({ ...cacheRef.current });
      })
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const tracksForSelected = useCallback(
    () => bagPaths.map((b) => tracks[b] ?? []),
    [bagPaths, tracks],
  );

  return { tracks, tracksForSelected, loading };
}
```

- [ ] **Step 2: `use-map-area.ts`** — Area state in the URL (mirrors the `writeUrl` discipline in `use-url-search.ts`; uses `react-router-dom` `useSearchParams`):

```ts
import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";

import type { Area } from "../api/types";
import { decodeArea, encodeArea } from "../lib/area-codec";

export function useMapArea() {
  const [searchParams, setSearchParams] = useSearchParams();
  const area = decodeArea(searchParams.get("area"));

  const setArea = useCallback(
    (next: Area | null) => {
      const params = new URLSearchParams(searchParams);
      if (next) params.set("area", encodeArea(next));
      else params.delete("area");
      setSearchParams(params, { replace: false });
    },
    [searchParams, setSearchParams],
  );

  return { area, setArea, clearArea: () => setArea(null) };
}
```

- [ ] **Step 3: Verify.** `npm run lint && npm run build` → PASS.
- [ ] **Step 4: Commit.**

```bash
git add frontend/src/hooks/use-bag-tracks.ts frontend/src/hooks/use-map-area.ts
git commit -m "[UI] feat: use-bag-tracks + use-map-area (URL-encoded Area state)"
```

## Task 4.5: Map components — `AreaChip`, `MapAreaDialog`, layers

**Files:** Create `frontend/src/components/search/area-chip.tsx`, `frontend/src/components/search/map-area-dialog.tsx`, `frontend/src/components/map/bag-trajectories.tsx`, `frontend/src/components/map/area-layer.tsx`.

> **Execution note:** react-leaflet v5 + geoman wiring is fiddly. Treat the Leaflet API specifics below as a concrete starting point and verify against the installed `react-leaflet@5` / `@geoman-io/leaflet-geoman-free` docs as you go (use the context7 MCP for current API). Import Leaflet's CSS once (`import "leaflet/dist/leaflet.css"` and `import "@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css"`) at the dialog module top. The OSM tile URL goes in a single swap-ready constant.

- [ ] **Step 1: `area-chip.tsx`** — mirrors `region-support-chip.tsx` exactly (presentational, `onEdit`/`onClear`):

```tsx
import { MapPin, X } from "lucide-react";

interface AreaChipProps {
  area: import("../../api/types").Area | null;
  count: number | null;     // located frames in area, or null while unknown
  disabled?: boolean;
  onEdit: () => void;
  onClear: () => void;
}

export function AreaChip({ area, count, disabled, onEdit, onClear }: AreaChipProps) {
  const label = !area
    ? "Set area on map"
    : area.kind === "circle"
      ? `Area · circle ~${Math.round(area.radius_m)} m${count !== null ? ` · ${count} frames` : ""}`
      : `Area · polygon${count !== null ? ` · ${count} frames` : ""}`;
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--bg-paper)] py-1 pl-2 pr-2 text-xs">
      <button type="button" onClick={onEdit} disabled={disabled} className="flex items-center gap-1.5 disabled:opacity-50" title="Edit area">
        <MapPin className="h-3.5 w-3.5" />
        <span>{label}</span>
      </button>
      {area ? (
        <button type="button" onClick={onClear} title="Clear area" aria-label="Clear area" className="text-[var(--ink-soft)] hover:text-[var(--ink)]">
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: `map/bag-trajectories.tsx`** — render polylines per bag (one color each) from the fetched tracks:

```tsx
import { Polyline } from "react-leaflet";
import type { TrackPoint } from "../../api/types";

const COLORS = ["#2563eb", "#dc2626", "#16a34a", "#9333ea", "#ea580c"];

export function BagTrajectories({ tracks }: { tracks: TrackPoint[][] }) {
  return (
    <>
      {tracks.map((pts, i) =>
        pts.length > 1 ? (
          <Polyline key={i} positions={pts.map((p) => [p.lat, p.lon] as [number, number])}
            pathOptions={{ color: COLORS[i % COLORS.length], weight: 3, opacity: 0.8 }} />
        ) : null,
      )}
    </>
  );
}
```

- [ ] **Step 3: `map/area-layer.tsx`** — geoman draw/edit, emitting the drawn Area via `onChange`. Concrete skeleton (verify geoman event names against the installed version):

```tsx
import { useEffect } from "react";
import { useMap } from "react-leaflet";
import "@geoman-io/leaflet-geoman-free";
import L from "leaflet";

import type { Area } from "../../api/types";

interface AreaLayerProps {
  area: Area | null;
  onChange: (area: Area) => void;
}

export function AreaLayer({ area, onChange }: AreaLayerProps) {
  const map = useMap();

  useEffect(() => {
    map.pm.addControls({ position: "topleft", drawCircle: true, drawPolygon: true,
      drawMarker: false, drawPolyline: false, drawRectangle: false, drawText: false, cutPolygon: false });

    const handleCreate = (e: { layer: L.Layer; shape: string }) => {
      // keep only the latest shape (single Area for v1)
      map.pm.getGeomanLayers().forEach((l) => { if (l !== e.layer) map.removeLayer(l); });
      if (e.shape === "Circle") {
        const c = e.layer as L.Circle;
        const ll = c.getLatLng();
        onChange({ kind: "circle", center: { lat: ll.lat, lon: ll.lng }, radius_m: c.getRadius() });
      } else if (e.shape === "Polygon") {
        const latlngs = ((e.layer as L.Polygon).getLatLngs()[0] as L.LatLng[]);
        onChange({ kind: "polygon", vertices: latlngs.map((p) => ({ lat: p.lat, lon: p.lng })) });
      }
    };

    map.on("pm:create", handleCreate);
    return () => {
      map.off("pm:create", handleCreate);
      map.pm.removeControls();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // NOTE: rendering an existing `area` back onto the map (edit case) is a follow-up
  // refinement — the dialog opens fresh-draw for v1; persisted area is shown via the chip.
  return null;
}
```

- [ ] **Step 4: `map-area-dialog.tsx`** — full-screen Radix dialog (mirrors `region-support-dialog.tsx`): mounts `MapContainer` + OSM `TileLayer` + `BagTrajectories` + `AreaLayer`, holds a draft area, shows a live in-area count via `countInArea`, and returns the area via `onConfirm` (the parent owns the URL write + search trigger):

```tsx
import { useEffect, useState } from "react";
import { MapContainer, TileLayer } from "react-leaflet";
import "leaflet/dist/leaflet.css";

import type { Area, TrackPoint } from "../../api/types";
import { countInArea } from "../../lib/area-geo";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";
import { AreaLayer } from "../map/area-layer";
import { BagTrajectories } from "../map/bag-trajectories";

const OSM_TILE_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const DEFAULT_CENTER: [number, number] = [45.88, 10.19];

interface MapAreaDialogProps {
  open: boolean;
  initialArea: Area | null;
  tracks: TrackPoint[][];
  onClose: () => void;
  onConfirm: (area: Area | null) => void;
}

export function MapAreaDialog({ open, initialArea, tracks, onClose, onConfirm }: MapAreaDialogProps) {
  const [draft, setDraft] = useState<Area | null>(initialArea);
  useEffect(() => { setDraft(initialArea); }, [initialArea, open]);

  const count = draft ? countInArea(draft, tracks) : null;
  const center = tracks[0]?.[0] ? [tracks[0][0].lat, tracks[0][0].lon] as [number, number] : DEFAULT_CENTER;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="h-[92vh] max-w-[96vw] overflow-hidden p-0 sm:max-w-[96vw]">
        <DialogHeader className="px-4 pt-4">
          <DialogTitle>Draw a search area</DialogTitle>
          <DialogDescription>Use the circle or polygon tool. Trajectories of the selected bags are shown.</DialogDescription>
        </DialogHeader>
        <div className="h-[70vh] w-full">
          <MapContainer center={center} zoom={15} className="h-full w-full">
            <TileLayer url={OSM_TILE_URL} attribution="&copy; OpenStreetMap contributors" />
            <BagTrajectories tracks={tracks} />
            <AreaLayer area={draft} onChange={setDraft} />
          </MapContainer>
        </div>
        <div className="flex items-center justify-between gap-2 px-4 py-3">
          <span className="text-xs text-[var(--ink-soft)]">
            {draft ? `${count} located frame${count === 1 ? "" : "s"} in area` : "No area drawn"}
          </span>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setDraft(null)} disabled={!draft}>Clear</Button>
            <Button type="button" variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
            <Button type="button" size="sm" onClick={() => onConfirm(draft)} disabled={!draft}>Apply</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 5: Verify.** `npm run lint && npm run build` → PASS (fix any react-leaflet v5 type mismatches surfaced).
- [ ] **Step 6: Commit.**

```bash
git add frontend/src/components/search/area-chip.tsx frontend/src/components/search/map-area-dialog.tsx frontend/src/components/map/
git commit -m "[UI] feat: AreaChip + full-screen MapAreaDialog (Leaflet + geoman draw + live count)"
```

## Task 4.6: Wire into `search.tsx` — browse vs compose routing

**Files:** Modify `frontend/src/pages/search.tsx` and `frontend/src/hooks/use-url-search.ts`.

Spec §6.3: `AreaChip` sits beside `BagPickerChip`, **orthogonal** to the Global/Region toggle (no third mode). Routing:
- mode Global, query empty, Area set ⇒ **browse** (`searchMap`).
- mode Global, query present, Area set ⇒ `search` with `area`.
- mode Region, Area set ⇒ region calls with `area`.
- Area empty ⇒ exactly today's behavior.

- [ ] **Step 1: Thread `area` through `use-url-search.ts`.** Add an `area?: Area` to the fetch path: read the `area` param (via `decodeArea(searchParams.get("area"))`), include it in the fetch key (`JSON.stringify({ q, similar, topK, bags, area })`), and pass it into `search.runSearch`/`runSimilarSearch`. Extend `useSearch.runSearch`/`runImageSearch`/`runSimilarSearch` to accept and forward `area` to the client calls. When `q` is empty but an `area` is set (browse), call `searchMap(area, bagPaths)` and store its `results`. Keep the existing no-area behavior identical.

  (Concrete change in `use-search.ts` `runSearch`: add an `area?: Area` param; pass `area` to `search({ query, bag_paths, top_k, area })`. In the browse branch add a `runMapBrowse(area, bagPaths)` that calls `searchMap` and sets results.)

- [ ] **Step 2: Mount the chip + dialog in `search.tsx`.** Add imports for `AreaChip`, `MapAreaDialog`, `useMapArea`, `useBagTracks`, `countInArea`. Inside `SearchPage`:

```tsx
  const { area, setArea, clearArea } = useMapArea();
  const { tracksForSelected } = useBagTracks(search.bagPaths);
  const [mapOpen, setMapOpen] = useState(false);
  const locatedBagCount = bags.filter((b) => b.is_located).length;
  const areaCount = area ? countInArea(area, tracksForSelected()) : null;
```

Render the chip next to `BagPickerChip`:

```tsx
        <BagPickerChip selectedBagIds={search.urlBags} onChange={(ids) => search.setBags(ids)} />
        <AreaChip
          area={area}
          count={areaCount}
          disabled={locatedBagCount === 0}
          onEdit={() => setMapOpen(true)}
          onClear={clearArea}
        />
```

Mount the dialog near `RegionSupportDialog`:

```tsx
      <MapAreaDialog
        open={mapOpen}
        initialArea={area}
        tracks={tracksForSelected()}
        onClose={() => setMapOpen(false)}
        onConfirm={(next) => { setMapOpen(false); setArea(next); }}
      />
```

- [ ] **Step 3: Browse routing + score guard.** In the Global-mode render branch, when `!hasGlobalQuery && area`, render the Map browse results (the `search` hook now returns browse rows when `q` is empty and `area` is set — surface them through the existing `ResultsGrid`). Hide the `FilterChip` min-score control in browse: in the browse case render `FilterChip` without `minScore`/`onMinScoreChange` (or pass a `hideMinScore` prop — add one to `FilterChip` if cleaner). Update the region score filter to tolerate optional score: `region.results.filter((r) => (r.similarity_score ?? 1) >= search.minScore)`.

- [ ] **Step 4: Verify.** `npm run lint && npm run build` → PASS.
- [ ] **Step 5: Commit.**

```bash
git add frontend/src/pages/search.tsx frontend/src/hooks/use-url-search.ts frontend/src/hooks/use-search.ts
git commit -m "[UI] feat: wire AreaChip/MapAreaDialog into search; browse vs compose routing"
```

## Task 4.7: Manual end-to-end verification

- [ ] **Step 1: Build + serve.** `cd frontend && npm run build`, then from repo root `JWT_SECRET=x REFRESH_SECRET=y uv run uvicorn app:app` and open http://localhost:8000 (or run `npm run dev` + uvicorn for hot reload at :5173).
- [ ] **Step 2: Checks** (record results in the PR):
  - With a GPS-located bag selected, the AreaChip is enabled; with none located, it's disabled with a tooltip.
  - Opening the dialog shows the selected bags' trajectories on the map; drawing a circle/polygon updates the live in-area count.
  - Apply → URL gains `?area=…`; reloading the page restores the area.
  - Global mode, empty query, area set → browse tiles appear (no min-score control); chronological.
  - Global mode + a text query + area → results are narrowed to the area.
  - Region mode + area → region results restricted to in-area frames.
  - Clearing the area returns to default behavior; sharing the URL reproduces the search.
- [ ] **Step 3: Commit** any fixes found during manual testing.

---

## Self-Review (spec coverage)

- **§2 Ingestion (GPS read, join, schema v5, stamp):** Tasks 0.1–0.6. ✅
- **§3 geo module (Area types, containment, locator):** Tasks 1.1–1.2. ✅
- **§4.1 Browse:** Task 2.1. **§4.2 Global compose (LanceDB prefilter):** Task 2.2. **§4.3 Region compose (IDSelector + exhaustive nprobe):** Tasks 3.1–3.2. ✅
- **§5 API (Area models, `area` on endpoints, `/search/map`, `/bags/track`, `is_located`, DI, factory):** Tasks 2.3–2.4. ✅
- **§6 Frontend (deps, types, codec, hooks, AreaChip, MapAreaDialog, map layers, search.tsx wiring, hide min-score, grey ungeotagged):** Tasks 4.1–4.7. ✅
- **§7 Config:** Task 0.1. ✅
- **§8 Error states:** no-GPS bag (0.6 `gps:null`; 2.4 `is_located=false`), dropout exclusion (0.3), zero-in-area empty-not-error (2.1/2.2 `continue`), bad polygon 422 (2.3), v4 bag skipped (schema bump + stamp absence → not located). ✅
- **§9 Testing:** every backend task is TDD; full-suite + real-bag e2e gate in Task 3.3. ✅
- **Out of scope (§11):** backfill pass, Track storage, spatial index, multi-Area, antimeridian — intentionally not in any task. ✅

**Known carry-over:** the pre-existing `image_router` auth gap (`test_auth_enforcement` 400-vs-401) is untouched (separate issue). The MapAreaDialog "render an existing area back for editing" is a deliberate v1 simplification (Task 4.5 note).
