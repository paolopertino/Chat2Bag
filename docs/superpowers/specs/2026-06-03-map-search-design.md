# Map Search — Geographic Frame Filtering by Drawn Area — Design Spec

**Date:** 2026-06-03
**Scope:** Add **Map search** — constraining Frames to those whose capture location falls inside a user-drawn **Area** (circle from a clicked point + radius, or a polygon), across bags. It is a **filter that composes** with the existing Global and Region search, and stands alone as a geographic browse. New ingestion reads the GPS topic (`/oxts/nav_sat_fix`) and attaches a **Frame location** to each Frame. **Global search ranking, Region search, the embedder, the patch index, chat, auth — all unchanged.**

**Source decisions (read first):**
- `CONTEXT.md` — glossary: **Fix**, **Track**, **Frame location**, **Area**, **Map search** (and the Region-vs-Area distinction: Region = pixels inside a Frame, Area = coordinates in the world).
- `docs/adr/0005-map-search-no-spatial-index.md` — nearest-Fix Frame location at extraction; metadata.json + in-Python Area filter, no spatial index; Area as prefilter-not-postfilter; filter-not-ranker.
- `docs/adr/0006-map-library-leaflet-osm.md` — Leaflet + react-leaflet + geoman + raster OSM.
- `docs/adr/0002-model-boundary-and-index-lifecycle.md` — schema-version re-index-warning pattern this reuses for the GPS stamp.

This spec consolidates the grilling session (2026-06-03) into an implementation-ready contract. Resolutions are marked **[DECISION]**; unconfirmed/soft items **[FLAG]**.

---

## 1. Overview

Today a Frame is searchable by *content* (Global = whole frame, Region = a Patch entity). Map search adds a *geographic* axis: **where in the world** the Frame was captured. The motivating use case is exploring fixed locations — intersections, roundabouts, traffic lights — possibly across multiple bags that drove the same place.

GPS arrives on a separate, faster topic (`/oxts/nav_sat_fix`, ~100 Hz) than the 1 FPS camera sampling, so a Frame has no location of its own. Ingestion builds the bag's **Track** (its ordered Fixes) and attaches one **Frame location** per Frame by nearest-timestamp join. At query time, an **Area** filters Frames by that location.

The pipeline, end to end:

```
EXTRACTION (one bag read)
  camera topics ─► Frames (timestamp_ns, topic, file_path)              ┐
  /oxts/nav_sat_fix ─► Fixes (lat, lon, t, status)  ─► Track            │ nearest Fix within ±1.0s
                                                                        ▼
                              Frame location (lat, lon) per Frame ─► metadata.json (schema v5)

QUERY (in-Python, no index)
  Area (circle | polygon) ─┐
  bag scope (BagPicker)  ──┼─►  resolve_area_to_frames()  ─►  in-area Frame set per bag
                           │       (bbox prefilter + exact haversine / point-in-polygon)
                           ▼
        ┌── no content query ──►  BROWSE: chronological + temporal-dedup ─► results
        ├── + Global query   ──►  LanceDB vector search PREFILTERED to in-area ids ─► ranked
        └── + Region query   ──►  faiss patch search PREFILTERED via IDSelector  ─► ranked
```

**Why this shape (locked in grilling + ADR 0005):**
- **Filter, not ranker.** In/out of an Area is boolean — there is no geographic similarity score. Standalone, the in-area set *is* the result. Composed, it narrows the candidate set the rankers see.
- **Prefilter, not postfilter.** A small Area must restrict candidates *before* ranking; filtering a city-wide top-k afterward would empty a single intersection. (ADR 0005.)
- **No spatial index.** Thousands of Frame locations per bag → an in-Python bbox + exact-shape scan is sub-millisecond; an R-tree/geohash/LanceDB-column scheme is complexity for no gain. `metadata.json` is the single source of truth. (ADR 0005 — the deliberate asymmetry with ADR 0004's patch index: *index millions of Patches, brute-force thousands of locations*.)
- **Nearest-Fix join, ±1.0s tolerance.** Exact in practice at 100 Hz; the tolerance drops GPS-dropout frames instead of mislocating them. (ADR 0005.)

**Non-goals:** no change to Global ranking, Region search, the embedder, the LanceDB CLS index, the faiss patch index, chat, or auth. The "map *is* the app's home screen" experience (grilling Option 3) is deferred to the later UX refactor; this spec builds the spatial filter and a full-screen map *dialog*, designed so that refactor can reuse them.

---

## 2. Ingestion — building the Track and Frame locations (`src/ingestion/bag_parser.py`)

### 2.1 Read the GPS topic in the existing bag pass — [DECISION]

`extract_frames` already opens the bag once and iterates `reader.messages(connections=…)` filtered to camera topics. Extend the connection filter to also include the **GPS topic** (new config `ingestion.gps_topic`, default `/oxts/nav_sat_fix`). In the message loop, branch on topic:
- **camera topic** → existing frame extraction (unchanged).
- **GPS topic** → deserialize `sensor_msgs/msg/NavSatFix`, collect a **Fix** `(timestamp_ns, lat, lon, status)` into an in-memory list. **No image work.**

`message_to_cvimage` is camera-only; GPS messages deserialize via the same `typestore.deserialize_cdr(rawdata, connection.msgtype)`.

**[DECISION] Fix validity filter (non-negotiable):** keep a Fix only if `status.status >= 0` (drops `NO_FIX = -1`) **and** `lat`, `lon` are finite (NavSatFix carries `NaN` when unfixed). Altitude, covariance, and `service` are ignored. (Spike 2026-06-03: real Fixes report `status.status = 2` — SBAS-augmented — so the `>= 0` filter keeps them correctly.)

**[FLAG — spike 2026-06-03]** The target bags expose **three** `sensor_msgs/msg/NavSatFix` topics: `/oxts/nav_sat_fix` (raw INS/GNSS, ~40 k msgs/bag), `/estimation/ekf/nav_sat_fix` (EKF-fused), and `/gnss/nav_sat_ref`. The default `/oxts/nav_sat_fix` works as-is; the EKF-fused topic may be more accurate. This is a single config value (`ingestion.gps_topic`) with no code impact — worth a quick eyeball on the map during Slice 4, not a blocker.

### 2.2 Join Fixes → Frame locations — [DECISION]

After the read, sort valid Fixes by timestamp. For each extracted Frame, binary-search the **nearest** Fix; if `|fix.t − frame.t| <= gps_max_gap_ns` (default **1.0 s**, config `ingestion.gps_max_gap_sec`), set `frame["lat"]`, `frame["lon"]`; else leave them **absent** (the Frame has no Frame location and is invisible to Map search). **No interpolation.** Frame counts are small; a per-frame binary search over the Fix array is trivial.

**[FLAG]** The high-frequency Track is **not** persisted — only the per-Frame location. The map's trajectory polyline is reconstructed from Frame locations (dense enough at 1 FPS), so no separate Track store is needed.

### 2.3 Metadata schema v5 — [DECISION]

`frames[]` entries gain **optional** `lat`/`lon`; a top-level **`gps` stamp** records that the bag was processed for GPS and the join parameters:

```jsonc
{
  "schema_version": 5,
  "cameras": [ … ],
  "embedder": { … },           // unchanged
  "region_index": { … },       // unchanged (v4)
  "gps": {                      // null/absent if the bag has no GPS topic
    "topic": "/oxts/nav_sat_fix",
    "max_gap_sec": 1.0,
    "fix_count": 60112,         // valid Fixes read
    "located_frame_count": 587, // frames that got a location
    "frame_count": 642
  },
  "frames": [
    { "timestamp_ns": …, "topic": …, "file_path": …, "lat": 45.8826, "lon": 10.1893 },
    { "timestamp_ns": …, "topic": …, "file_path": … },   // no nearby Fix → no location
    …
  ]
}
```

`METADATA_SCHEMA_VERSION = 5` (`schema_versions.py`), history entry:
```
  5 — Adds optional per-frame `lat`/`lon` (Frame location) + top-level `gps` stamp
      (Map search). CLS/region layout unchanged from v4.
```

**[DECISION] A bag with no GPS topic** sets `gps` to null and writes no `lat`/`lon`; Map search simply never returns its Frames. `is_located` (§5.3) = `gps` present and `located_frame_count > 0`. This mirrors the embedder/region stamp-skip pattern (ADR 0002) — a visible, actionable "this bag has no GPS / re-extract" signal, never a crash.

### 2.4 Acquisition & backfill — [DECISION]

GPS is **raw bag data** (lives only in the `.mcap`), so enabling Map search on a bag requires a **bag re-read** — unlike Region search's thumbnail-only pass. At the current 2-bag scale this is folded into **re-extraction** (extraction-only acquisition, grilling). **[FLAG]** Keep the GPS read + join as an **isolated module** (`src/ingestion/gps.py`: `read_fixes(reader, topic) -> list[Fix]`, `locate_frames(frames, fixes, max_gap_ns)`) so a future lightweight "locate-only" backfill pass (re-open the `.mcap`, read the GPS topic only, re-join, rewrite `metadata.json` — no thumbnail re-extraction, no re-embed) is a trivial add if the corpus grows. Out of scope to build now.

---

## 3. The Area and the filter (`src/region/` … or new `src/geo/`)

**[DECISION] New module `src/geo/`** (parallel to `src/region/`), keeping geographic logic self-contained:

```
src/geo/
  __init__.py
  area.py        # Area types + point-in-area tests
  locator.py     # load Frame locations from metadata.json; resolve Area -> in-area Frame set
```

### 3.1 Area types — [DECISION]

```python
@dataclass(frozen=True)
class Circle:
    lat: float; lon: float; radius_m: float

@dataclass(frozen=True)
class Polygon:
    vertices: tuple[tuple[float, float], ...]   # (lat, lon), ≥3

Area = Circle | Polygon
```

- **Circle** containment: haversine(center, point) ≤ `radius_m`.
- **Polygon** containment: ray-casting point-in-polygon on (lat, lon).
- Both get a cheap **bounding box** (`Area.bbox()`) used as a coarse prefilter before the exact test.

**[FLAG] Out of scope:** antimeridian-crossing and polar polygons (single-city 2D assumed); polygon self-intersection is prevented client-side by geoman and irrelevant to ray-casting anyway.

### 3.2 The locator — the one filter function — [DECISION]

```python
def resolve_area_to_frames(area: Area, bag_paths: list[str]) -> dict[str, list[LocatedFrame]]:
    """For each bag: read metadata.json frames with a Frame location, keep those
    inside `area` (bbox prefilter -> exact test). Returns per-bag in-area Frames
    carrying frame_id (list index), file_path, topic, timestamp_ns, lat, lon."""
```

This single function powers **all three** query paths: it *is* the browse result (§4.1), and it produces the **allowed-id set** that prefilters Global (§4.2) and Region (§4.3). `frame_id` is the `frames[]` list index — the same identity Region search uses (ADR 0004 §schema), so the in-area set drops straight into a faiss `IDSelector`.

---

## 4. Querying — browse and compose (`src/services/`, searchers)

### 4.1 Browse (standalone Map search) — [DECISION]

New `MapSearchService.browse(area, bag_paths, top_k?) -> list[dict]`:
1. `resolve_area_to_frames(area, bag_paths)`.
2. **Temporal dedup**, reusing `GlobalSearcher._apply_temporal_dedup` semantics: per `(bag_path, topic)` sequence, collapse Frames within the dedup window (default 20 s) to one representative — so a dwelling vehicle yields a few tiles, separate passes survive. Since there is **no score**, the representative is the **first** (earliest) Frame in each window.
3. **Order chronologically** by `(bag_path, timestamp_ns)`; keep all cameras (per-camera Frames, consistent with the rest of the app).
4. For **circle** Areas, attach `distance_m` (haversine to center) for display / optional secondary sort.
5. **[FLAG]** Cap the returned set at a sane limit (default **500** after dedup) and signal truncation, so a giant Area can't return tens of thousands of tiles. Make it configurable.

Result rows reuse the existing `SearchResult` shape (`bag_path`, `timestamp_ns`, `file_path`, `topic`, `source_bag`) **minus** `similarity_score` (browse has none) **plus** optional `lat`, `lon`, `distance_m`. **[DECISION]** `similarity_score` is omitted/null for browse rows; the frontend hides the min-score filter in browse (§6.3).

### 4.2 Compose with Global search — [DECISION]

`GlobalSearcher` gains an optional `area: Area | None` on its search entry points. When set:
- Resolve the in-area `frame_id`/`file_path` set per bag once (the locator).
- Push it into the LanceDB query as a **prefilter** so ranking happens over in-area Frames only: `table.search(q).metric("cosine").where("file_path IN (…)", prefilter=True)`.
  **[DECISION — spike-validated 2026-06-03]** On the pinned lancedb 0.27.1, `prefilter=True` with an `IN (…)` list is correct (results ⊆ the allowed set, ranked identically to an exact in-memory cosine) and does **not** empty small sets — a 3-element allowed set returns 3 rows, whereas `prefilter=False` (post-filter) returns 0, confirming the prefilter requirement empirically. A full-table 1180-path `IN`-list (~200 KB clause string) ranks in ~30 ms with no truncation. No correctness or limit concern at current scale. The escape hatch (ADR 0005: lat/lon LanceDB columns + a native bbox `.where`) and the in-memory numpy-cosine fallback are retained **only** for the hypothetical case where per-bag located-Frame counts explode into the tens of thousands.
- Temporal dedup and `top_k` apply **after** ranking, unchanged.

### 4.3 Compose with Region search — [DECISION]

`RegionSearcher` gains the same optional `area`. faiss cannot filter on metadata, so:
- Resolve the in-area `frame_id` set per bag (the locator).
- Restrict the patch search to those Frames via a faiss **`IDSelector`** over patch ids whose `patch_frames[patch_id] ∈ in-area set` (build an `IDSelectorBatch` from the `patch_frames.npy` map, §ADR 0004), passed through `faiss.SearchParametersIVF(sel=…, nprobe=…)`. Group → MaxSim → dedup → `top_k` as today.
- **[DECISION — spike-validated 2026-06-03] Raise `nprobe` while an Area is active.** The `IDSelector` + `SearchParametersIVF` mechanism works on the pinned faiss-cpu 1.14.2 (results confined to the selector), but at the resident `nprobe=16` (of `nlist`≈468–656) it **under-recalls small Areas**: the few allowed patches scatter into unprobed IVF cells, giving frame-level recall@10 ≈ 0.80–0.85 for ≤10-frame Areas. Because the `IDSelector` already bounds the distance work to allowed patches, raising `nprobe` is cheap — exhaustive (`nprobe = nlist`) restores recall to 1.0 and costs only ~6 ms (3-frame Area) to ~41 ms (300-frame Area). **The query path therefore sets `nprobe = nlist` whenever an Area is present**; the resident `nprobe` is unchanged for ordinary Region search. The originally-proposed over-fetch + post-filter fallback is **dropped** — it was measured *worse* than the gap it patched (recall ≈ 0.61–0.73 on tiny Areas).

---

## 5. API & wiring (`src/api/`)

### 5.1 Area payload — [DECISION]

A typed, discriminated `area` object, shared by every endpoint:

```jsonc
// circle
{ "kind": "circle", "center": { "lat": 45.88, "lon": 10.19 }, "radius_m": 120 }
// polygon
{ "kind": "polygon", "vertices": [ { "lat": …, "lon": … }, … ] }   // ≥3
```

Pydantic discriminated union; validates `radius_m > 0`, `≥3` vertices, lat∈[-90,90], lon∈[-180,180].

### 5.2 Endpoints — [DECISION]

All under the existing authed `/api` router.

| Endpoint | Change | Notes |
|---|---|---|
| `POST /api/search` | **+ optional `area`** | Global, filtered to Area when present. |
| `POST /api/search/image` | **+ optional `area`** (JSON form field) | Multipart; `area` as a JSON string field. |
| `POST /api/search/similar` | **+ optional `area`** | |
| `POST /api/search/region/by-text` `by-frame` `by-image` | **+ optional `area`** | Region, filtered to Area. (`by-image` as JSON form field.) |
| `POST /api/search/map` | **NEW** | Browse: `{ area, bag_paths, top_k? }` → chronological deduped in-area Frames. |
| `GET /api/bags/track` | **NEW** | `?bag_path=…` → `{ bag_path, points: [{ lat, lon, timestamp_ns }] }` for the trajectory polyline. **[DECISION]** sits next to `/api/bags/frames` + `/info`. Optional `?stride=N` downsample (default raw at 1 FPS). |
| `GET /api/bags/scan`, `GET /api/bags/info` | **+ `is_located`, `located_frame_count`** | So the picker/map know which bags are Map-searchable. |

**[DECISION]** `area` absent ⇒ every existing endpoint behaves exactly as today (pure additive change). When `area` is present but resolves to zero in-area Frames across the scope ⇒ empty results (not an error).

### 5.3 Service + DI

- New `MapSearchService` (mirrors `SearchService`): validates `area` + `bag_paths`, calls the locator + dedup for browse.
- `GlobalSearcher` / `RegionSearcher` take `area` through their existing services (`SearchService`, `RegionSearchService` gain an optional `area` arg that they parse into the `Area` dataclass and forward).
- `dependencies.py`: `get_map_search_service(request)`. `component_factory.py`: `create_map_search_service()`. No new resident model or heavy state — the locator just reads `metadata.json`. **[DECISION]** Map search has **no capability gate** (no embedder dependency); it's available whenever any selected bag `is_located`.

---

## 6. Frontend (`frontend/src/`)

### 6.1 Library & deps — [DECISION] (ADR 0006)

Add `leaflet`, `react-leaflet`, `@geoman-io/leaflet-geoman-free`, `leaflet.markercluster` (+ types) to `frontend/package.json`. Raster OSM tile URL in one constant (swap-ready).

### 6.2 Components — [DECISION]

```
frontend/src/components/search/
  area-chip.tsx          # mirrors region-support-chip: shows current Area + count, edit/clear
  map-area-dialog.tsx    # full-screen map: tiles, trajectories, geoman draw (circle/polygon),
                         #   live in-area count, confirm/cancel  (mirrors region-support-dialog)
frontend/src/components/map/
  bag-trajectories.tsx   # polylines from /api/bags/track for selected bags (color per bag)
  area-layer.tsx         # render + edit the drawn Area
frontend/src/hooks/
  use-map-area.ts        # Area state (URL-encoded), set/clear, live count
  use-bag-tracks.ts      # fetch + cache trajectories for the selected bags
frontend/src/lib/
  area-codec.ts          # encode/decode Area <-> URL param
frontend/src/api/
  types.ts               # Area, TrackResponse, +lat/lon/distance_m on SearchResult, +is_located on BagInfo
  client.ts              # getTrack(), searchMap(), area arg threaded into existing search calls
```

### 6.3 Integration — [DECISION]

- **`AreaChip`** sits beside `BagPickerChip` on `search.tsx`, **orthogonal to the Global/Region toggle** (active in any mode). Empty → "Set area on map"; set → "Area · circle ~120 m · 47 located frames" with edit/clear.
- Clicking it opens **`MapAreaDialog`** (full-screen): renders the **BagPicker-selected** bags' trajectories (the single shared scope — grilling), lets the user click (circle + radius slider) or draw (polygon) via geoman, shows a **live in-area count**, and on confirm writes the Area to the URL.
- Results render through the **existing `ResultsGrid`**:
  - mode Global, query empty, Area set ⇒ **browse** (`/api/search/map`).
  - mode Global, query present, Area set ⇒ `/api/search` with `area`.
  - mode Region, Area set ⇒ region endpoints with `area`.
- **[DECISION]** Area lives in the **URL** (`?area=…`) like `?mode=region`, for shareable searches — circle encodes trivially; polygon as compact encoded vertices (`area-codec.ts`). Reuses the atomic-URL-write discipline already in `search.tsx` (single `setSearchParams` to avoid the race noted there).
- **[DECISION]** In browse (no score), the `FilterChip`'s **min-score control is hidden**; `top_k`/result cap still apply.
- **[FLAG]** Ungeotagged bags: greyed in the BagPicker (or annotated "no GPS"); absent from the map. If *no* selected bag `is_located`, the AreaChip is disabled with a tooltip.

---

## 7. Configuration (`config/settings.yaml`, `app_config.py`)

```yaml
ingestion:
  camera_topics: [ … ]            # unchanged
  gps_topic: "/oxts/nav_sat_fix"  # NEW: GPS topic read during extraction (null ⇒ no GPS read)
  gps_max_gap_sec: 1.0            # NEW: nearest-Fix join tolerance
  # … sampling_fps, long_side, batch_size unchanged

search:
  temporal_dedup_window_sec: 20.0 # reused by Map browse
  map_browse_cap: 500             # NEW: max browse results after dedup
```

`app_config.py`: add `gps_topic`, `gps_max_gap_sec` to `IngestionConfig`; `map_browse_cap` to `SearchConfig`. Frozen dataclasses, parsed in `get_app_config()`. **[DECISION]** circle radius bounds + default are **frontend** concerns (default ~100 m, slider 10 m–2 km), not backend config — the backend accepts any `radius_m > 0`.

---

## 8. Error states & edge cases

| Scenario | Behaviour |
|---|---|
| Bag has no GPS topic | `gps: null`, no Frame locations; `is_located=false`; never returned by Map search; greyed in UI. |
| Frame in a GPS dropout (no Fix within ±1.0 s) | No Frame location; excluded from Map search (not mislocated). |
| All Fixes invalid (`NO_FIX`/`NaN`) | `fix_count=0`, `located_frame_count=0`, `is_located=false`. |
| Area resolves to zero in-area Frames | Empty results, not an error. |
| Global compose: in-area `IN`-list very large | Works at current scale (spike: ~30 ms over a full 1180-Frame `IN`-list); escape hatch = lat/lon LanceDB columns (ADR 0005) or in-memory numpy rank (§4.2). |
| Region compose: `IDSelector` × IVF-PQ recall | Resolved (spike 2026-06-03): set `nprobe = nlist` while an Area is active → recall@10 = 1.0 at ~6–41 ms; the `IDSelector` bounds the cost (§4.3). |
| Huge Area (e.g. whole city) | `map_browse_cap` truncates with a signaled "showing first N" (§4.1). |
| Polygon < 3 vertices / bad lat-lon | `400` (Pydantic validation). |
| v4 bag (no `gps` stamp) queried via Map search | Skipped (no locations); surfaced as "N bags have no GPS — re-extract to enable Map search". |
| Frontend ns precision | The Fix↔Frame join is **server-side on integer `timestamp_ns`**; the browser never does it, sidestepping the JS 2^53 ns-precision landmine. Track/result timestamps shown in the UI follow the existing sequence-viewer handling. |

---

## 9. Testing

Run: `PYTHONPATH="" uv run pytest tests/`.

- **GPS read + join** (`tests/test_gps.py`): synthetic Fixes (incl. `NO_FIX`/`NaN`) + Frames; assert nearest-within-tolerance assignment, dropout exclusion, validity filtering, no interpolation.
- **Area containment** (`tests/test_geo_area.py`): circle haversine boundary; polygon ray-casting incl. on-edge and outside-bbox; bbox prefilter correctness.
- **Locator** (`tests/test_geo_locator.py`): metadata.json (v5) with mixed located/unlocated frames → correct per-bag in-area sets + `frame_id` identity preserved.
- **Browse** (`MapSearchService`): chronological order, per-`(bag,topic)` temporal dedup (dwelling collapses, separate passes survive), all-cameras kept, `distance_m` for circles, `map_browse_cap` truncation.
- **Compose**: `GlobalSearcher` with `area` prefilters to in-area ids (small-area-still-returns-its-best, *not* emptied by a city-wide top-k); `RegionSearcher` with `area` via `IDSelector` (or fallback).
- **Schema v5**: `gps` null vs populated; `is_located` derivation; v4 bag skipped by Map search.
- **API contracts**: `area` discriminated-union validation; `/api/search/map`; `/api/bags/track`; `is_located`/`located_frame_count` on scan/info; `area` optional on existing endpoints (absent ⇒ unchanged behavior).

---

## 10. Implementation slices (for `/plan`)

- **Slice 0 — GPS read + join (backend, no product surface).** `src/ingestion/gps.py` (`read_fixes`, `locate_frames`); wire the GPS topic into `BagParser.extract_frames` (branch in the message loop); schema v5 + `gps` stamp; `IngestionConfig` fields. Tests: read/join/validity/dropout. Re-extract the 2 existing bags → assert Frame locations + stamp.
- **Slice 1 — Area + locator.** `src/geo/area.py` (Circle/Polygon, bbox, containment) + `src/geo/locator.py` (`resolve_area_to_frames`). Tests: containment + locator.
- **Slice 2 — Browse + Global compose + API.** `MapSearchService.browse` (dedup, order, cap, distance); `area` on `GlobalSearcher`/`SearchService`; `POST /api/search/map`; `area` on `/api/search` + `/image` + `/similar`; `GET /api/bags/track`; `is_located` on scan/info. (LanceDB prefilter mechanism already spike-validated — §4.2.) Tests: browse + Global compose + API contracts.
- **Slice 3 — Region compose.** `area` on `RegionSearcher`/`RegionSearchService` via `IDSelector` + `SearchParametersIVF`, setting `nprobe = nlist` while an Area is active (spike-validated — §4.3); `area` on `/search/region/*`. Tests: region compose recall under selection (small-Area recall@10 ≈ 1.0).
- **Slice 4 — Frontend map.** Add Leaflet deps; `MapAreaDialog` (tiles, trajectories, geoman draw, live count); `AreaChip`; `use-map-area` (URL codec) + `use-bag-tracks`; thread `area` through `use-search`/`use-region-search` + a browse path; hide min-score in browse; grey ungeotagged bags. Wire into `search.tsx`.

---

## 11. Out of scope / deferred / open

- **"Map as the app's home"** (grilling Option 3) — deferred to the later UX refactor; this spec's full-screen `MapAreaDialog` + trajectory components are built to be reused there.
- **Locate-only backfill pass** (re-read GPS topic without re-extracting/re-embedding) — designed for (isolated `gps.py` module) but not built; extraction-only acquisition is fine at 2 bags (ADR 0005).
- **High-frequency Track storage** — rejected; only per-Frame locations persist (ADR 0005); trajectory polyline is reconstructed from them.
- **Spatial index / LanceDB lat-lon columns** — rejected now (ADR 0005); documented escape hatch if per-bag Frame counts explode or `IN`-lists bite (§4.2).
- **Multiple simultaneous Areas / Area union** — single Area for v1.
- **Altitude / 3D, antimeridian, polar Areas** — ignored (single-city 2D).
- **[RESOLVED 2026-06-03] GPS message type coverage** — both target bags carry `/oxts/nav_sat_fix` as the standard `sensor_msgs/msg/NavSatFix`, present in `rosbags` 0.11.0 `Stores.LATEST`; deserializes cleanly (real `status.status = 2`). No custom-OXTS field mapping needed. (Bags also expose `/estimation/ekf/nav_sat_fix` and `/gnss/nav_sat_ref` as NavSatFix — see §2.1 [FLAG].)
- **[RESOLVED 2026-06-03] LanceDB `IN`-list prefilter** (correct, ~30 ms full-table — §4.2) and **faiss `IDSelector` × IVF-PQ recall** (mechanism works; set `nprobe = nlist` when an Area is active to restore small-Area recall — §4.3) — both spike-validated against the pinned versions; see those sections.
- **[FLAG] Mini-map on the bag detail page** (show a bag's trajectory + the hit) — natural follow-up, not in scope.
