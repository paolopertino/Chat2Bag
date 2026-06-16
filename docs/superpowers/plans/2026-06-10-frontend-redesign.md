# Map-First Frontend Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the accreted multi-page UI with a two-surface map-first frontend (Map home `/` + Bag viewer `/bags/:bagId`) per the approved spec `docs/superpowers/specs/2026-06-10-frontend-redesign-design.md`.

**Architecture:** Phase 1 lands four backend changes (batch tracks endpoint, Frame location on every search hit, `top_k` default 100, `/api/image` auth) with TDD. Phases 2–5 build the Map home (MapLibre GL + side panel + Omnibox + Results rail + lightbox) and the Bag viewer (free snap-grid via react-grid-layout + timeline pins + scoped Omnibox + extraction), reusing existing hooks (`useUrlSearch`, `useRegionSearch`, `useBagsState`, `useSampleBrowser`) and components (`RegionPointCanvas`, `SampleResultLightbox`, `AuthImage`, chips). Phase 6 deletes every legacy page and the Leaflet stack.

**Tech Stack:** FastAPI + pytest (backend); React 19, react-router-dom v7, maplibre-gl v5 + OpenFreeMap tiles, terra-draw (+ maplibre adapter), react-grid-layout, Radix UI, Tailwind, sonner (frontend). Frontend has **no test framework** — verification is `npm run lint && npm run build` + listed manual checks.

**Conventions:** Backend tests run with `PYTHONPATH="" uv run pytest …` (host ROS2 env leaks otherwise). Commit tags: `[Backend]`, `[Frontend]`, `[UI]`, `[Config]`, `[Docs]`. Exact line numbers below were verified on `feat/frontend-refactor` at plan time; re-locate by symbol if drifted.

---

## Phase 1 — Backend

### Task 1: Batch tracks endpoint `GET /api/bags/tracks`

**Files:**
- Modify: `src/api/bags.py` (after the `/track` endpoint, ~line 188)
- Test: `tests/test_bags_tracks.py` (create)

- [ ] **Step 1: Write the failing tests**

Mirror the `_bag` helper pattern from `tests/test_bags_track.py` (it builds a bag dir with a valid `metadata.json` under the artifact dir — copy its exact directory naming; shown here as `.bag_chat`, verify against that file).

```python
import json
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.api import bags_router


def _client(bypass_auth):
    app = FastAPI()
    app.include_router(bags_router)
    bypass_auth(app)
    return TestClient(app)


def _bag(tmp_path: Path, name: str, n_located: int, n_unlocated: int = 0) -> str:
    bag = tmp_path / name
    art = bag / ".bag_chat"  # match the artifact dir used in tests/test_bags_track.py::_bag
    art.mkdir(parents=True)
    frames = [
        {"timestamp_ns": i, "topic": "/cam", "file_path": f"f_{i}.jpg", "lat": 45.0 + i * 1e-4, "lon": 9.0}
        for i in range(n_located)
    ] + [
        {"timestamp_ns": 10_000 + i, "topic": "/cam", "file_path": f"u_{i}.jpg"}
        for i in range(n_unlocated)
    ]
    (art / "metadata.json").write_text(json.dumps({"frames": frames}), encoding="utf-8")
    return str(bag)


def test_tracks_returns_one_entry_per_located_bag(tmp_path, bypass_auth):
    a = _bag(tmp_path, "bag_a", 3)
    b = _bag(tmp_path, "bag_b", 2)
    resp = _client(bypass_auth).get(
        "/api/bags/tracks", params=[("bag_paths", a), ("bag_paths", b), ("max_points", 500)]
    )
    assert resp.status_code == 200
    tracks = resp.json()["tracks"]
    assert {t["bag_path"] for t in tracks} == {a, b}
    assert [p["timestamp_ns"] for p in tracks[0]["points"]] == sorted(
        p["timestamp_ns"] for p in tracks[0]["points"]
    )


def test_tracks_skips_bags_without_metadata_or_fixes(tmp_path, bypass_auth):
    a = _bag(tmp_path, "bag_a", 3)
    unlocated = _bag(tmp_path, "bag_c", 0, n_unlocated=4)
    missing = str(tmp_path / "bag_missing")
    resp = _client(bypass_auth).get(
        "/api/bags/tracks",
        params=[("bag_paths", a), ("bag_paths", unlocated), ("bag_paths", missing)],
    )
    assert resp.status_code == 200
    assert [t["bag_path"] for t in resp.json()["tracks"]] == [a]


def test_tracks_decimates_to_max_points(tmp_path, bypass_auth):
    a = _bag(tmp_path, "bag_a", 100)
    resp = _client(bypass_auth).get(
        "/api/bags/tracks", params=[("bag_paths", a), ("max_points", 10)]
    )
    pts = resp.json()["tracks"][0]["points"]
    assert len(pts) <= 10
    assert pts[0]["timestamp_ns"] == 0  # first point kept
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `PYTHONPATH="" uv run pytest tests/test_bags_tracks.py -v`
Expected: FAIL — 404 (route `/api/bags/tracks` matched by `/track`? No: distinct path → 404 Not Found on all three tests).

- [ ] **Step 3: Implement the endpoint**

In `src/api/bags.py`, add `import math` at the top (with the other stdlib imports) and append after the `/track` endpoint:

```python
@router.get("/tracks")
async def bag_tracks(
    bag_paths: list[str] = Query(..., description="Bag directories to load Tracks for"),
    max_points: int = Query(500, ge=2, le=5000, description="Max points returned per Track"),
):
    """All requested bags' Tracks in one call, decimated for map rendering.

    Bags with no metadata or no located frames are silently omitted (a Bag
    without a Track is simply not drawable) — never a 404.
    """
    tracks = []
    for raw in bag_paths:
        path = Path(raw).expanduser().resolve()
        metadata_path = _metadata_path_for_bag(path)
        if not metadata_path.exists() or not metadata_path.is_file():
            continue
        with metadata_path.open("r", encoding="utf-8") as handle:
            metadata = json.load(handle)
        located = [
            {"lat": f["lat"], "lon": f["lon"], "timestamp_ns": f["timestamp_ns"]}
            for f in metadata.get("frames", [])
            if "lat" in f and "lon" in f
        ]
        if not located:
            continue
        located.sort(key=lambda p: p["timestamp_ns"])
        stride = max(1, math.ceil(len(located) / max_points))
        tracks.append(
            {"bag_path": str(path), "bag_name": path.name, "points": located[::stride]}
        )
    return {"tracks": tracks}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `PYTHONPATH="" uv run pytest tests/test_bags_tracks.py tests/test_bags_track.py -v`
Expected: all PASS (including the pre-existing `/track` tests — no regression).

- [ ] **Step 5: Commit**

```bash
git add src/api/bags.py tests/test_bags_tracks.py
git commit -m "[Backend] Add batch GET /api/bags/tracks for the Map home"
```

### Task 2: Frame location on every search hit

Global (`/search`, `/search/image`, `/search/similar`) hits already carry `lat`/`lon` when present in the LanceDB table; Region hits (`region/by-text`, `by-frame`, `by-image`) never do (see `src/region/region_search.py:125-132`). Add a join helper and apply it to every ranking endpoint so the frontend can always pin located hits.

**Files:**
- Create: `src/services/frame_location.py`
- Modify: `src/core/storage.py` (move/expose the metadata path resolver), `src/api/bags.py`, `src/api/search_routes.py`
- Test: `tests/test_frame_location.py` (create)

- [ ] **Step 1: Extract the metadata path resolver**

Move the private `_metadata_path_for_bag(path: Path) -> Path` helper from `src/api/bags.py` into `src/core/storage.py` as a public `metadata_path_for_bag(bag: Path) -> Path` — body identical, no behavior change. In `src/api/bags.py` replace the local definition with `from src.core.storage import metadata_path_for_bag` and keep a module-level alias `_metadata_path_for_bag = metadata_path_for_bag` so existing call sites and tests are untouched.

Run: `PYTHONPATH="" uv run pytest tests/test_bags_track.py tests/test_bags_tracks.py -v` — Expected: PASS (pure move).

- [ ] **Step 2: Write the failing tests**

```python
import json
from pathlib import Path

from src.services.frame_location import attach_locations


def _bag_with_metadata(tmp_path: Path) -> str:
    bag = tmp_path / "bag_a"
    art = bag / ".bag_chat"  # match tests/test_bags_track.py::_bag
    art.mkdir(parents=True)
    frames = [
        {"timestamp_ns": 1, "topic": "/cam", "file_path": "f1.jpg", "lat": 45.1, "lon": 9.1},
        {"timestamp_ns": 2, "topic": "/cam", "file_path": "f2.jpg"},  # unlocated
    ]
    (art / "metadata.json").write_text(json.dumps({"frames": frames}), encoding="utf-8")
    return str(bag.resolve())


def test_attach_fills_missing_lat_lon(tmp_path):
    bag = _bag_with_metadata(tmp_path)
    hits = [{"bag_path": bag, "topic": "/cam", "timestamp_ns": 1, "similarity_score": 0.9}]
    attach_locations(hits)
    assert hits[0]["lat"] == 45.1 and hits[0]["lon"] == 9.1


def test_attach_leaves_unlocated_and_existing_untouched(tmp_path):
    bag = _bag_with_metadata(tmp_path)
    hits = [
        {"bag_path": bag, "topic": "/cam", "timestamp_ns": 2},          # frame has no Fix
        {"bag_path": bag, "topic": "/cam", "timestamp_ns": 1, "lat": 1.0, "lon": 2.0},
    ]
    attach_locations(hits)
    assert "lat" not in hits[0]
    assert hits[1]["lat"] == 1.0  # pre-existing value wins


def test_attach_survives_missing_metadata(tmp_path):
    hits = [{"bag_path": str(tmp_path / "nope"), "topic": "/cam", "timestamp_ns": 1}]
    attach_locations(hits)  # must not raise
    assert "lat" not in hits[0]
```

Run: `PYTHONPATH="" uv run pytest tests/test_frame_location.py -v`
Expected: FAIL — `ModuleNotFoundError: src.services.frame_location`.

- [ ] **Step 3: Implement the helper**

`src/services/frame_location.py`:

```python
"""Attach Frame locations (lat/lon) to search hits by joining bag metadata."""

import json
from pathlib import Path
from typing import Any

from src.core.storage import metadata_path_for_bag

LocationIndex = dict[tuple[str, int], tuple[float, float]]


def _location_index(bag_path: str) -> LocationIndex:
    index: LocationIndex = {}
    metadata_path = metadata_path_for_bag(Path(bag_path))
    if not metadata_path.exists() or not metadata_path.is_file():
        return index
    with metadata_path.open("r", encoding="utf-8") as handle:
        metadata = json.load(handle)
    for frame in metadata.get("frames", []):
        if "lat" in frame and "lon" in frame:
            index[(frame["topic"], int(frame["timestamp_ns"]))] = (frame["lat"], frame["lon"])
    return index


def attach_locations(hits: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Fill lat/lon in-place on hits that lack them; one metadata read per bag."""
    cache: dict[str, LocationIndex] = {}
    for hit in hits:
        if hit.get("lat") is not None and hit.get("lon") is not None:
            continue
        bag_path = hit.get("bag_path")
        if not bag_path:
            continue
        if bag_path not in cache:
            cache[bag_path] = _location_index(bag_path)
        location = cache[bag_path].get((hit.get("topic"), int(hit["timestamp_ns"])))
        if location is not None:
            hit["lat"], hit["lon"] = location
    return hits
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `PYTHONPATH="" uv run pytest tests/test_frame_location.py -v` — Expected: PASS.

- [ ] **Step 5: Apply to every ranking endpoint**

In `src/api/search_routes.py`, add `from src.services.frame_location import attach_locations` and wrap the results of each ranking endpoint just before the `return`: `/search` (line ~97: `results = attach_locations(search_service.search(...))` — or call after assignment), `/search/image`, `/search/similar`, `/search/region/by-text`, `/search/region/by-frame`, `/search/region/by-image`. Do **not** touch `/search/map` (its rows always carry lat/lon).

Run: `PYTHONPATH="" uv run pytest tests/ -v` — Expected: full suite PASS (existing contract tests don't forbid extra keys; if one asserts exact hit shape, extend its expected dict with the joined lat/lon).

- [ ] **Step 6: Commit**

```bash
git add src/core/storage.py src/api/bags.py src/api/search_routes.py src/services/frame_location.py tests/test_frame_location.py
git commit -m "[Backend] Attach Frame location to all search hits"
```

### Task 3: Raise `top_k` defaults to 100

**Files:**
- Modify: `src/api/search_routes.py` (lines 41–47, 54, 67, 74, 128, 216)
- Test: `tests/test_search_defaults.py` (create)

- [ ] **Step 1: Write the failing test**

```python
from src.api.search_routes import (
    RegionByFrameRequest,
    RegionByTextRequest,
    SearchRequest,
)


def test_top_k_defaults_are_100():
    assert SearchRequest(query="x", bag_paths=[]).top_k == 100
    assert RegionByTextRequest(text="x", bag_paths=[]).top_k == 100
    assert RegionByFrameRequest(
        support_file_path="/f.jpg", points=[{"x": 0.5, "y": 0.5}], bag_paths=[]
    ).top_k == 100


def test_top_k_allows_up_to_500():
    assert SearchRequest(query="x", bag_paths=[], top_k=500).top_k == 500
```

Run: `PYTHONPATH="" uv run pytest tests/test_search_defaults.py -v` — Expected: FAIL (defaults are 5, cap is 100).

- [ ] **Step 2: Implement**

In `src/api/search_routes.py`, change every ranking-endpoint `top_k` from `Field(default=5, ge=1, le=100)` to `Field(default=100, ge=1, le=500)` — in `SearchRequest`, `SimilarSearchRequest` (line ~54), `RegionByFrameRequest`, `RegionByTextRequest`, and the image-search/region-by-image form params from `Form(default=5, ge=1, le=100)` to `Form(default=100, ge=1, le=500)` (lines ~128 and ~216). Leave `MapSearchRequest` alone (`map_browse_cap` governs it).

- [ ] **Step 3: Run tests**

Run: `PYTHONPATH="" uv run pytest tests/test_search_defaults.py tests/ -v` — Expected: PASS (fix any existing test asserting the old `le=100` rejection).

- [ ] **Step 4: Commit**

```bash
git add src/api/search_routes.py tests/test_search_defaults.py
git commit -m "[API] Raise search top_k default to 100, cap to 500"
```

### Task 4: Require auth on `/api/image`

`tests/test_auth_enforcement.py:30` already expects 401 from `image_router` — this is the known gap.

**Files:**
- Modify: `src/api/image.py`, `tests/test_image_route.py`

- [ ] **Step 1: Run the existing test to confirm it fails**

Run: `PYTHONPATH="" uv run pytest tests/test_auth_enforcement.py -v -k image`
Expected: FAIL (route currently serves without auth → 200/400, not 401).

- [ ] **Step 2: Add the dependency**

In `src/api/image.py`:

```python
from fastapi import APIRouter, Depends, HTTPException, Query
from src.auth.dependencies import require_current_user  # match the import used in src/api/bags.py

router = APIRouter(
    prefix="/api",
    tags=["images"],
    dependencies=[Depends(require_current_user)],
)
```

(Copy the exact `require_current_user` import path from `src/api/bags.py`'s imports.)

- [ ] **Step 3: Fix the now-401 image tests**

`tests/test_image_route.py` builds its client without auth bypass. Update its app factory to install `bypass_auth` exactly like `tests/test_bags_track.py::_client` does (add the `bypass_auth` fixture parameter to each test and pass the app through it).

- [ ] **Step 4: Run tests**

Run: `PYTHONPATH="" uv run pytest tests/test_auth_enforcement.py tests/test_image_route.py tests/test_api_contracts.py -v`
Expected: all PASS. The frontend already authenticates image fetches (`fetchImageAsObjectUrl` sends the Bearer token), so no frontend change is needed.

- [ ] **Step 5: Commit**

```bash
git add src/api/image.py tests/test_image_route.py
git commit -m "[Backend] Require auth on /api/image"
```

---

## Phase 2 — Map home foundation

### Task 5: Frontend dependencies

**Files:** Modify: `frontend/package.json`

- [ ] **Step 1: Install**

```bash
cd frontend
npm install maplibre-gl terra-draw terra-draw-maplibre-gl-adapter react-grid-layout
npm install -D @types/react-grid-layout
```

(Leaflet stays installed until Phase 6 — legacy pages still import it.)

- [ ] **Step 2: Verify build still passes**

Run: `cd frontend && npm run build` — Expected: success.

- [ ] **Step 3: Commit**

```bash
git add frontend/package.json frontend/package-lock.json
git commit -m "[Config] Add maplibre-gl, terra-draw, react-grid-layout"
```

### Task 6: Full-bleed layout + route swap

**Files:**
- Create: `frontend/src/components/layout/full-bleed-layout.tsx`, `frontend/src/pages/map-home.tsx` (skeleton)
- Modify: `frontend/src/router.tsx`

- [ ] **Step 1: Create the layout**

`frontend/src/components/layout/full-bleed-layout.tsx`:

```tsx
import { Outlet } from "react-router-dom";

import { TopBar } from "./top-bar";

export function FullBleedLayout() {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[var(--canvas)] text-[var(--ink)]">
      <TopBar />
      <main className="relative min-h-0 flex-1">
        <Outlet />
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Create the Map home skeleton**

`frontend/src/pages/map-home.tsx`:

```tsx
export function MapHomePage() {
  return <div className="absolute inset-0" data-testid="map-home" />;
}
```

- [ ] **Step 3: Swap routes**

In `frontend/src/router.tsx`, inside the `<ProtectedRoute />` children, mount the new layout as a sibling of `MainLayout` and move the index route to it; delete the Dashboard and `datasets/*` routes:

```tsx
{
  element: <ProtectedRoute />,
  children: [
    {
      element: <FullBleedLayout />,
      children: [{ index: true, element: <MapHomePage /> }],
    },
    {
      element: <MainLayout />,
      children: [
        { path: "workspace", element: <WorkspacePage /> },
        { path: "search", element: <SearchPage /> },
        {
          path: "bags",
          element: <BagsLayout />,
          children: [
            { index: true, element: <BagsListPage /> },
            { path: ":bagId", element: <BagDetailPage /> },
          ],
        },
        { path: "*", element: <Navigate to="/" replace /> },
      ],
    },
  ],
},
```

Remove the now-unused `DashboardPage`/`ComingSoon` imports. Legacy `/search`, `/workspace`, `/bags` stay reachable until Phase 6.

- [ ] **Step 4: Verify**

Run: `cd frontend && npm run lint && npm run build` — Expected: clean.
Manual: `npm run dev`, log in → `/` shows the empty full-bleed page with TopBar; `/search` and `/bags` still work.

- [ ] **Step 5: Commit**

```bash
git add frontend/src
git commit -m "[UI] Mount full-bleed Map home at / (dashboard removed)"
```

### Task 7: MapLibre map + fleet Tracks

**Files:**
- Create: `frontend/src/components/map/maplibre-map.tsx`, `frontend/src/components/map/fleet-tracks-layer.tsx`, `frontend/src/hooks/use-fleet-tracks.ts`
- Modify: `frontend/src/api/types.ts`, `frontend/src/api/client.ts`, `frontend/src/pages/map-home.tsx`

- [ ] **Step 1: API types + client function**

In `frontend/src/api/types.ts` add:

```typescript
export interface FleetTrack {
  bag_path: string;
  bag_name: string;
  points: TrackPoint[];
}
export interface FleetTracksResponse {
  tracks: FleetTrack[];
}
```

In `frontend/src/api/client.ts` add (next to the existing exported API functions, reusing the module's `http`):

```typescript
export function fetchFleetTracks(bagPaths: string[], maxPoints = 500): Promise<FleetTracksResponse> {
  const params = new URLSearchParams();
  for (const p of bagPaths) params.append("bag_paths", p);
  params.set("max_points", String(maxPoints));
  return http<FleetTracksResponse>(`/api/bags/tracks?${params}`);
}
```

- [ ] **Step 2: Map shell component**

`frontend/src/components/map/maplibre-map.tsx`:

```tsx
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

const MapContext = createContext<maplibregl.Map | null>(null);

export function useMap(): maplibregl.Map {
  const map = useContext(MapContext);
  if (!map) throw new Error("useMap must be used inside <MapLibreMap>");
  return map;
}

/** Run fn once the style is loaded (immediately if it already is). */
export function whenStyleReady(map: maplibregl.Map, fn: () => void): void {
  if (map.isStyleLoaded()) fn();
  else map.once("style.load", fn);
}

export function MapLibreMap({ children }: { children?: ReactNode }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [map, setMap] = useState<maplibregl.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const m = new maplibregl.Map({
      container: containerRef.current,
      style: STYLE_URL,
      center: [9.19, 45.46], // northern Italy; fitBounds overrides once Tracks load
      zoom: 5,
      attributionControl: { compact: true },
    });
    m.once("style.load", () => m.setProjection({ type: "globe" }));
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    setMap(m);
    return () => {
      setMap(null);
      m.remove();
    };
  }, []);

  return (
    <>
      <div ref={containerRef} className="absolute inset-0" />
      {map ? <MapContext.Provider value={map}>{children}</MapContext.Provider> : null}
    </>
  );
}
```

- [ ] **Step 3: Tracks hook**

`frontend/src/hooks/use-fleet-tracks.ts`:

```tsx
import { useEffect, useState } from "react";

import { fetchFleetTracks } from "../api/client";
import type { FleetTrack } from "../api/types";

export function useFleetTracks(bagPaths: string[]): {
  tracks: FleetTrack[];
  loading: boolean;
} {
  const [tracks, setTracks] = useState<FleetTrack[]>([]);
  const [loading, setLoading] = useState(false);
  const key = bagPaths.slice().sort().join("|");

  useEffect(() => {
    if (!key) {
      setTracks([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchFleetTracks(key.split("|"))
      .then((resp) => {
        if (!cancelled) setTracks(resp.tracks);
      })
      .catch(() => {
        if (!cancelled) setTracks([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [key]);

  return { tracks, loading };
}
```

- [ ] **Step 4: Tracks layer**

`frontend/src/components/map/fleet-tracks-layer.tsx`:

```tsx
import maplibregl from "maplibre-gl";
import { useEffect, useRef } from "react";

import type { FleetTrack } from "../../api/types";
import { useMap, whenStyleReady } from "./maplibre-map";

const PALETTE = [
  "#4da3ff", "#39d98a", "#b07cff", "#ffb84d",
  "#ff6b81", "#4dd6c1", "#c9d64d", "#7c9cff",
];

export function trackColor(index: number): string {
  return PALETTE[index % PALETTE.length];
}

function toFeatureCollection(tracks: FleetTrack[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: tracks.map((t, i) => ({
      type: "Feature",
      properties: { bag_path: t.bag_path, bag_name: t.bag_name, color: trackColor(i) },
      geometry: {
        type: "LineString",
        coordinates: t.points.map((p) => [p.lon, p.lat]),
      },
    })),
  };
}

interface FleetTracksLayerProps {
  tracks: FleetTrack[];
  hoveredBagPath: string | null;
  onTrackClick: (bagPath: string) => void;
}

export function FleetTracksLayer({ tracks, hoveredBagPath, onTrackClick }: FleetTracksLayerProps) {
  const map = useMap();
  const didFitRef = useRef(false);
  const clickRef = useRef(onTrackClick);
  clickRef.current = onTrackClick;

  useEffect(() => {
    whenStyleReady(map, () => {
      const data = toFeatureCollection(tracks);
      const source = map.getSource("fleet-tracks") as maplibregl.GeoJSONSource | undefined;
      if (source) {
        source.setData(data);
      } else {
        map.addSource("fleet-tracks", { type: "geojson", data });
        map.addLayer({
          id: "fleet-tracks-line",
          type: "line",
          source: "fleet-tracks",
          paint: { "line-color": ["get", "color"], "line-width": 3, "line-opacity": 0.85 },
        });
        map.addLayer({
          id: "fleet-tracks-hover",
          type: "line",
          source: "fleet-tracks",
          paint: { "line-color": ["get", "color"], "line-width": 7 },
          filter: ["==", ["get", "bag_path"], ""],
        });
        map.on("click", "fleet-tracks-line", (e) => {
          const f = e.features?.[0];
          if (f) clickRef.current(f.properties.bag_path as string);
        });
        map.on("mouseenter", "fleet-tracks-line", () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", "fleet-tracks-line", () => {
          map.getCanvas().style.cursor = "";
        });
      }
      if (!didFitRef.current && tracks.length > 0) {
        const bounds = new maplibregl.LngLatBounds();
        for (const t of tracks) for (const p of t.points) bounds.extend([p.lon, p.lat]);
        map.fitBounds(bounds, { padding: 80, maxZoom: 14, duration: 1500 });
        didFitRef.current = true;
      }
    });
  }, [map, tracks]);

  useEffect(() => {
    whenStyleReady(map, () => {
      if (map.getLayer("fleet-tracks-hover")) {
        map.setFilter("fleet-tracks-hover", ["==", ["get", "bag_path"], hoveredBagPath ?? ""]);
      }
    });
  }, [map, hoveredBagPath]);

  return null;
}
```

- [ ] **Step 5: Wire into the page**

Replace `frontend/src/pages/map-home.tsx`:

```tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { FleetTracksLayer } from "../components/map/fleet-tracks-layer";
import { MapLibreMap } from "../components/map/maplibre-map";
import { useBagsState } from "../hooks/use-bags";
import { useFleetTracks } from "../hooks/use-fleet-tracks";

export function MapHomePage() {
  const navigate = useNavigate();
  const bagsState = useBagsState();
  const indexedPaths = bagsState.bags.filter((b) => b.is_indexed).map((b) => b.bag_path);
  const { tracks } = useFleetTracks(indexedPaths);
  const [hoveredBagPath, setHoveredBagPath] = useState<string | null>(null);
  void setHoveredBagPath; // wired to the side panel in Task 8

  // Reuse the exact bagId encoding BagsListPage uses for its /bags/:bagId links
  // (see frontend/src/pages/bags/bags-list-page.tsx — import the same helper).
  const openBag = (bagPath: string) => navigate(`/bags/${encodeBagId(bagPath)}`);

  return (
    <div className="absolute inset-0">
      <MapLibreMap>
        <FleetTracksLayer
          tracks={tracks}
          hoveredBagPath={hoveredBagPath}
          onTrackClick={openBag}
        />
      </MapLibreMap>
    </div>
  );
}
```

Import `encodeBagId` from wherever `BagsListPage` gets it (it exists — `/bags/:bagId` links work today). Check `useBagsState`'s hook name/export in `frontend/src/hooks/use-bags.ts` (return shape verified: `{ bags, onScan, onIndex, rootDir, ... }`).

- [ ] **Step 6: Verify**

Run: `cd frontend && npm run lint && npm run build` — Expected: clean.
Manual (backend running, bags indexed): `/` shows the globe → zooms to northern Italy with colored Tracks; clicking a Track opens the old bag detail page.

- [ ] **Step 7: Commit**

```bash
git add frontend/src
git commit -m "[UI] Map home: MapLibre globe with fleet Tracks"
```

### Task 8: Side panel (Bags tab)

**Files:**
- Create: `frontend/src/components/map/map-side-panel.tsx`
- Modify: `frontend/src/pages/map-home.tsx`

- [ ] **Step 1: Build the panel**

`frontend/src/components/map/map-side-panel.tsx` — overlay panel fed by `useBagsState` (don't re-fetch; receive state as props). Uses the existing Radix/Tailwind idioms (`Tabs` from the existing UI kit under `frontend/src/components/ui/`):

```tsx
import { PanelLeftClose, PanelLeftOpen, RefreshCw } from "lucide-react";
import { useState, type ReactNode } from "react";

import type { BagInfo } from "../../api/types";
import { trackColor } from "./fleet-tracks-layer";

interface MapSidePanelProps {
  bags: BagInfo[];
  locatedOrder: string[]; // bag_paths in the order tracks are drawn (for color match)
  rootDir: string;
  setRootDir: (dir: string) => void;
  isScanning: boolean;
  onScan: () => void;
  onIndex: (bagPath: string) => void;
  onHoverBag: (bagPath: string | null) => void;
  onOpenBag: (bagPath: string) => void;
  jobsTab: ReactNode; // filled in Task 17; pass null until then
}

function statusBadge(bag: BagInfo): string {
  if (bag.status === "indexing") return "⏳ indexing";
  if (!bag.is_indexed) return "not indexed";
  if (!bag.is_located) return "⚠ no GPS";
  return "✓";
}

export function MapSidePanel(props: MapSidePanelProps) {
  const [open, setOpen] = useState(true);
  const [tab, setTab] = useState<"bags" | "jobs">("bags");

  if (!open) {
    return (
      <button
        className="absolute left-4 top-20 z-10 rounded-md border border-[var(--line)] bg-[var(--panel)] p-2"
        onClick={() => setOpen(true)}
        aria-label="Open bag panel"
      >
        <PanelLeftOpen className="h-4 w-4" />
      </button>
    );
  }

  return (
    <div className="absolute bottom-28 left-4 top-20 z-10 flex w-72 flex-col rounded-lg border border-[var(--line)] bg-[var(--panel)]/95 shadow-lg backdrop-blur">
      <div className="flex items-center justify-between border-b border-[var(--line)] px-3 py-2">
        <div className="flex gap-1 text-sm">
          <button
            className={tab === "bags" ? "font-semibold" : "opacity-60"}
            onClick={() => setTab("bags")}
          >
            Bags
          </button>
          <span className="opacity-30">·</span>
          <button
            className={tab === "jobs" ? "font-semibold" : "opacity-60"}
            onClick={() => setTab("jobs")}
          >
            Jobs
          </button>
        </div>
        <button onClick={() => setOpen(false)} aria-label="Collapse panel">
          <PanelLeftClose className="h-4 w-4" />
        </button>
      </div>

      {tab === "bags" ? (
        <>
          <div className="flex gap-2 border-b border-[var(--line)] p-2">
            <input
              className="min-w-0 flex-1 rounded border border-[var(--line)] bg-transparent px-2 py-1 text-xs"
              value={props.rootDir}
              placeholder="bags root directory"
              onChange={(e) => props.setRootDir(e.target.value)}
            />
            <button
              className="rounded border border-[var(--line)] px-2"
              onClick={props.onScan}
              disabled={props.isScanning}
              aria-label="Scan root"
            >
              <RefreshCw className={"h-4 w-4" + (props.isScanning ? " animate-spin" : "")} />
            </button>
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto p-1">
            {props.bags.map((bag) => {
              const colorIdx = props.locatedOrder.indexOf(bag.bag_path);
              return (
                <li
                  key={bag.bag_path}
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-white/5"
                  onMouseEnter={() => props.onHoverBag(bag.bag_path)}
                  onMouseLeave={() => props.onHoverBag(null)}
                  onClick={() => bag.is_indexed && props.onOpenBag(bag.bag_path)}
                >
                  <span
                    className="h-2 w-2 flex-none rounded-full"
                    style={{ background: colorIdx >= 0 ? trackColor(colorIdx) : "#777" }}
                  />
                  <span className="min-w-0 flex-1 truncate">{bag.bag_name}</span>
                  <span className="flex-none text-xs opacity-70">{statusBadge(bag)}</span>
                  {!bag.is_indexed && bag.status !== "indexing" ? (
                    <button
                      className="flex-none rounded border border-[var(--line)] px-1.5 text-xs"
                      onClick={(e) => {
                        e.stopPropagation();
                        props.onIndex(bag.bag_path);
                      }}
                    >
                      index
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-2">{props.jobsTab}</div>
      )}
    </div>
  );
}
```

(Adapt CSS variable names — `--panel`, `--line` — to the ones the existing UI kit actually uses; check `frontend/src/index.css`.)

- [ ] **Step 2: Wire into the page**

In `map-home.tsx`, render `<MapSidePanel …/>` as a sibling of `<MapLibreMap>` inside the page wrapper; pass `bags={bagsState.bags}`, `locatedOrder={tracks.map((t) => t.bag_path)}`, `onHoverBag={setHoveredBagPath}`, `onOpenBag={openBag}`, the scan/index props from `bagsState`, and `jobsTab={null}` for now.

- [ ] **Step 3: Verify**

`npm run lint && npm run build`; manual: hover a located row → its Track thickens; ⚠ no-GPS rows show no color; index button starts indexing with polling status; collapse/expand works.

- [ ] **Step 4: Commit**

```bash
git add frontend/src
git commit -m "[UI] Map home side panel: bag list, scan, index, hover-highlight"
```

---

## Phase 3 — Omnibox, results, lightbox

### Task 9: `useOmniboxSearch` orchestration hook

**Files:**
- Create: `frontend/src/hooks/use-omnibox-search.ts`

The mode table (spec): text→Global; text+Region chip→`region/by-text`; image+0 points→Global image; image+points→`region/by-image`; frame+points→`region/by-frame`; Area alone→Map browse. Built on `useUrlSearch` (URL state, Global + Map browse — verify in `use-url-search.ts` that an Area with empty `q` triggers the map-browse path; `/search` relies on it today) and `useRegionSearch`.

- [ ] **Step 1: Implement the hook**

```tsx
import { useState } from "react";

import type { Area, Point, SearchResult } from "../api/types";
import { useMapArea } from "./use-map-area";
import { useRegionSearch } from "./use-region-search";
import { useUrlSearch } from "./use-url-search";

export type SupportSource =
  | { kind: "upload"; file: File; objectUrl: string }
  | { kind: "frame"; filePath: string };

export interface OmniboxSearch {
  text: string;
  setText: (t: string) => void;
  regionMode: boolean;
  setRegionMode: (on: boolean) => void;
  support: SupportSource | null;
  points: Point[];
  setSupport: (s: SupportSource | null, points?: Point[]) => void;
  setPoints: (p: Point[]) => void;
  area: Area | null;
  setArea: (a: Area | null) => void;
  bagPaths: string[];
  setBags: (ids: string[]) => void;
  topK: number;
  setTopK: (k: number) => void;
  minScore: number;
  setMinScore: (s: number) => void;
  results: SearchResult[];
  isSearching: boolean;
  activeKind: "none" | "global" | "region" | "browse";
  submit: () => void;
  loadMore: () => void;
  clear: () => void;
  fetchHeatmap: ReturnType<typeof useRegionSearch>["fetchHeatmap"];
}

export function useOmniboxSearch(options?: { scope?: { bagPaths: string[] } }): OmniboxSearch {
  const url = useUrlSearch({ scope: options?.scope, topKDefault: 100 });
  const region = useRegionSearch();
  const { area, setArea } = useMapArea();
  const [text, setText] = useState(url.q);
  const [regionMode, setRegionMode] = useState(false);
  const [support, setSupportState] = useState<SupportSource | null>(null);
  const [points, setPoints] = useState<Point[]>([]);

  const regionActive = region.query !== null;
  const results = regionActive ? region.results : url.results;
  const activeKind: OmniboxSearch["activeKind"] = regionActive
    ? "region"
    : url.results.length > 0 || url.isSearching
      ? url.q || url.similar
        ? "global"
        : area
          ? "browse"
          : "none"
      : "none";

  function runRegion(topK: number) {
    if (support?.kind === "upload" && points.length > 0) {
      region.runImage(support.file, support.objectUrl, points, url.bagPaths, topK, area ?? undefined);
    } else if (support?.kind === "frame" && points.length > 0) {
      region.runFrame(support.filePath, points, url.bagPaths, topK, area ?? undefined);
    } else if (regionMode && text.trim()) {
      region.runText(text.trim(), url.bagPaths, topK, area ?? undefined);
    }
  }

  function submit() {
    if (support && points.length > 0) {
      url.clear();
      runRegion(url.topK);
      return;
    }
    if (support?.kind === "upload") {
      region.clear();
      void url.submitImage(support.file); // Global image search
      return;
    }
    if (text.trim()) {
      if (regionMode) {
        url.clear();
        region.runText(text.trim(), url.bagPaths, url.topK, area ?? undefined);
      } else {
        region.clear();
        url.submitText(text.trim()); // also covers Map browse composition via URL area
      }
      return;
    }
    // Empty query: Area alone = Map browse; useUrlSearch picks it up from the URL area param.
    region.clear();
    url.submitText("");
  }

  function loadMore() {
    const next = Math.min(url.topK * 2, 500);
    url.setTopK(next);
    if (regionActive) region.rerunWithArea(url.bagPaths, next, area ?? undefined);
    // Global/browse: useUrlSearch re-runs on topK change.
  }

  function clear() {
    setText("");
    setSupportState(null);
    setPoints([]);
    setRegionMode(false);
    region.clear();
    url.clear();
  }

  return {
    text,
    setText,
    regionMode,
    setRegionMode,
    support,
    points,
    setSupport: (s, p) => {
      setSupportState(s);
      setPoints(p ?? []);
    },
    setPoints,
    area,
    setArea,
    bagPaths: url.bagPaths,
    setBags: url.setBags,
    topK: url.topK,
    setTopK: url.setTopK,
    minScore: url.minScore,
    setMinScore: url.setMinScore,
    results,
    isSearching: url.isSearching || region.isSearching,
    activeKind,
    submit,
    loadMore,
    clear,
    fetchHeatmap: region.fetchHeatmap,
  };
}
```

While here: in `frontend/src/hooks/use-url-search.ts`, change the module's top-k default constant to `100` (find the existing default used when `topKDefault` is not passed). Verify (and adjust if needed) that `useUrlSearch` re-runs the active query when `setTopK` changes and runs Map browse when `q` is empty but `area` is set — both behaviors exist on today's `/search` page; mirror its wiring if anything was page-local.

- [ ] **Step 2: Verify**

`npm run lint && npm run build` — Expected: clean (hook not yet mounted).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/use-omnibox-search.ts frontend/src/hooks/use-url-search.ts
git commit -m "[Frontend] Add Omnibox search orchestration hook"
```

### Task 10: Omnibox component

**Files:**
- Create: `frontend/src/components/omnibox/omnibox.tsx`, `frontend/src/components/omnibox/support-chip.tsx`
- Reuse: `SearchInput`, `RegionSupportDialog`/`RegionPointCanvas`, `BagPickerChip`, `FilterChip` (all under `frontend/src/components/search/`)

- [ ] **Step 1: Build the Omnibox**

`frontend/src/components/omnibox/omnibox.tsx`:

```tsx
import { Crosshair, MapPinned, X } from "lucide-react";
import { useState } from "react";

import { BagPickerChip } from "../search/bag-picker-chip";
import { FilterChip } from "../search/filter-chip";
import { RegionSupportDialog } from "../search/region-support-dialog";
import { SearchInput } from "../search/search-input";
import type { OmniboxSearch } from "../../hooks/use-omnibox-search";

interface OmniboxProps {
  search: OmniboxSearch;
  /** Hidden in the Bag viewer (no map to draw on). */
  showAreaChip?: boolean;
  /** Hidden in the Bag viewer (scope is pinned). */
  showBagChip?: boolean;
  onStartAreaDraw?: (kind: "circle" | "polygon") => void;
  className?: string;
}

export function Omnibox({
  search,
  showAreaChip = true,
  showBagChip = true,
  onStartAreaDraw,
  className,
}: OmniboxProps) {
  const [supportDialogOpen, setSupportDialogOpen] = useState(false);

  return (
    <div className={className}>
      <div className="flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--panel)]/95 px-3 py-1.5 shadow-lg backdrop-blur">
        <div className="min-w-0 flex-1">
          <SearchInput
            value={search.text}
            placeholder={
              search.support
                ? "press Enter to search with the attached image"
                : "search frames… (attach an image, or draw an Area and press Enter)"
            }
            onChange={search.setText}
            onSubmit={() => search.submit()}
            onClear={() => search.clear()}
            onImageUpload={(file) => {
              search.setSupport({ kind: "upload", file, objectUrl: URL.createObjectURL(file) });
              setSupportDialogOpen(true); // place points (optional) right away
            }}
          />
        </div>

        {search.support ? (
          <button
            className="flex items-center gap-1 rounded-full border border-amber-400/60 bg-amber-400/10 px-2 py-0.5 text-xs"
            onClick={() => setSupportDialogOpen(true)}
            title="Edit Region points"
          >
            support · {search.points.length} pts
            <X
              className="h-3 w-3"
              onClick={(e) => {
                e.stopPropagation();
                search.setSupport(null);
              }}
            />
          </button>
        ) : (
          <button
            className={
              "flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs " +
              (search.regionMode
                ? "border-sky-400/70 bg-sky-400/15"
                : "border-[var(--line)] opacity-60")
            }
            onClick={() => search.setRegionMode(!search.regionMode)}
            title="Region search: rank by the best-matching Patch instead of the whole Frame"
          >
            <Crosshair className="h-3 w-3" /> region
          </button>
        )}

        {showAreaChip ? (
          search.area ? (
            <button
              className="flex items-center gap-1 rounded-full border border-emerald-400/70 bg-emerald-400/15 px-2 py-0.5 text-xs"
              onClick={() => search.setArea(null)}
              title="Clear Area"
            >
              <MapPinned className="h-3 w-3" /> area <X className="h-3 w-3" />
            </button>
          ) : (
            <button
              className="flex items-center gap-1 rounded-full border border-[var(--line)] px-2 py-0.5 text-xs opacity-60"
              onClick={() => onStartAreaDraw?.("polygon")}
              title="Draw an Area on the map (right-click for circle)"
              onContextMenu={(e) => {
                e.preventDefault();
                onStartAreaDraw?.("circle");
              }}
            >
              <MapPinned className="h-3 w-3" /> area
            </button>
          )
        ) : null}

        {showBagChip ? (
          <BagPickerChip /* match existing props: selected bag ids + onChange(search.setBags) */ />
        ) : null}

        <FilterChip /* match existing props: topK/minScore values + setters from search */ />
      </div>

      {supportDialogOpen && search.support ? (
        <RegionSupportDialog
          /* match existing props (see frontend/src/components/search/region-support-dialog.tsx):
             image src = support.kind === "upload" ? objectUrl : AuthImage of filePath,
             points = search.points, onChange = search.setPoints,
             onClose = () => setSupportDialogOpen(false),
             onConfirm = () => { setSupportDialogOpen(false); search.submit(); } */
        />
      ) : null}
    </div>
  );
}
```

`BagPickerChip`, `FilterChip`, and `RegionSupportDialog` already exist — open each file and wire their actual prop names (they were built for `/search`; if `RegionSupportDialog` is too coupled to that page, render a plain Radix `Dialog` wrapping `RegionPointCanvas` (`{src, alt, points, onChange}` — verified) plus Cancel/Search buttons instead).

- [ ] **Step 2: Mount on the Map home**

In `map-home.tsx`: `const search = useOmniboxSearch();` and render `<Omnibox search={search} onStartAreaDraw={setDrawMode} className="absolute left-1/2 top-4 z-20 w-[min(760px,92vw)] -translate-x-1/2" />` (`drawMode` state lands in Task 11; pass a no-op until then).

- [ ] **Step 3: Verify**

`npm run lint && npm run build`. Manual: text search returns results (console-log `search.results.length` or temporarily render the count); region chip + text hits `region/by-text`; attaching an image opens the point canvas; Enter without points runs Global image search; with points runs Region.

- [ ] **Step 4: Commit**

```bash
git add frontend/src
git commit -m "[UI] Omnibox: one field, mode implied by attachments"
```

### Task 11: Area drawing on the main map

**Files:**
- Create: `frontend/src/components/map/area-draw.tsx`, `frontend/src/components/map/area-display-layer.tsx`
- Modify: `frontend/src/pages/map-home.tsx`

- [ ] **Step 1: Drawing component (terra-draw)**

`frontend/src/components/map/area-draw.tsx`:

```tsx
import { useEffect, useRef } from "react";
import { TerraDraw, TerraDrawCircleMode, TerraDrawPolygonMode } from "terra-draw";
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter";

import type { Area, LatLon } from "../../api/types";
import { useMap } from "./maplibre-map";

function haversineMeters(a: LatLon, b: LatLon): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function featureToArea(feature: GeoJSON.Feature, mode: "circle" | "polygon"): Area | null {
  if (feature.geometry.type !== "Polygon") return null;
  const ring = feature.geometry.coordinates[0].slice(0, -1); // drop closing vertex
  const vertices = ring.map(([lon, lat]) => ({ lat, lon }));
  if (mode === "polygon") return vertices.length >= 3 ? { kind: "polygon", vertices } : null;
  const center = {
    lat: vertices.reduce((s, v) => s + v.lat, 0) / vertices.length,
    lon: vertices.reduce((s, v) => s + v.lon, 0) / vertices.length,
  };
  return { kind: "circle", center, radius_m: haversineMeters(center, vertices[0]) };
}

interface AreaDrawProps {
  mode: "circle" | "polygon" | null; // null = drawing off
  onArea: (area: Area) => void;
  onDone: () => void;
}

export function AreaDraw({ mode, onArea, onDone }: AreaDrawProps) {
  const map = useMap();
  const drawRef = useRef<TerraDraw | null>(null);

  useEffect(() => {
    const draw = new TerraDraw({
      adapter: new TerraDrawMapLibreGLAdapter({ map }),
      modes: [new TerraDrawPolygonMode(), new TerraDrawCircleMode()],
    });
    draw.start();
    draw.setMode("static");
    drawRef.current = draw;
    return () => {
      draw.stop();
      drawRef.current = null;
    };
  }, [map]);

  useEffect(() => {
    const draw = drawRef.current;
    if (!draw) return;
    if (!mode) {
      draw.setMode("static");
      return;
    }
    draw.setMode(mode);
    const onFinish = (id: string | number) => {
      const feature = draw.getSnapshot().find((f) => f.id === id);
      if (feature) {
        const area = featureToArea(feature as GeoJSON.Feature, mode);
        if (area) onArea(area);
      }
      draw.clear();
      draw.setMode("static");
      onDone();
    };
    draw.on("finish", onFinish);
    return () => {
      draw.off("finish", onFinish);
    };
  }, [mode, onArea, onDone]);

  return null;
}
```

(Check terra-draw's current event signature — `draw.on("finish", (id, context) => …)` — against the installed version's types and adjust the callback parameters to compile.)

- [ ] **Step 2: Persistent Area display layer**

`frontend/src/components/map/area-display-layer.tsx` — renders the committed Area (from URL state) independently of the draw tool:

```tsx
import maplibregl from "maplibre-gl";
import { useEffect } from "react";

import type { Area } from "../../api/types";
import { useMap, whenStyleReady } from "./maplibre-map";

function areaToPolygon(area: Area): GeoJSON.Feature {
  if (area.kind === "polygon") {
    const ring = area.vertices.map((v) => [v.lon, v.lat]);
    ring.push(ring[0]);
    return { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } };
  }
  const ring: [number, number][] = [];
  const latRad = (area.center.lat * Math.PI) / 180;
  for (let i = 0; i <= 64; i++) {
    const t = (i / 64) * 2 * Math.PI;
    ring.push([
      area.center.lon + ((area.radius_m * Math.sin(t)) / (111320 * Math.cos(latRad))),
      area.center.lat + (area.radius_m * Math.cos(t)) / 111320,
    ]);
  }
  return { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } };
}

export function AreaDisplayLayer({ area }: { area: Area | null }) {
  const map = useMap();

  useEffect(() => {
    whenStyleReady(map, () => {
      const data: GeoJSON.FeatureCollection = {
        type: "FeatureCollection",
        features: area ? [areaToPolygon(area)] : [],
      };
      const source = map.getSource("area-display") as maplibregl.GeoJSONSource | undefined;
      if (source) {
        source.setData(data);
      } else {
        map.addSource("area-display", { type: "geojson", data });
        map.addLayer({
          id: "area-display-fill",
          type: "fill",
          source: "area-display",
          paint: { "fill-color": "#34d399", "fill-opacity": 0.12 },
        });
        map.addLayer({
          id: "area-display-line",
          type: "line",
          source: "area-display",
          paint: { "line-color": "#34d399", "line-width": 2, "line-dasharray": [2, 1] },
        });
      }
    });
  }, [map, area]);

  return null;
}
```

- [ ] **Step 3: Wire into the page**

In `map-home.tsx`: add `const [drawMode, setDrawMode] = useState<"circle" | "polygon" | null>(null);` inside `<MapLibreMap>` render `<AreaDraw mode={drawMode} onArea={search.setArea} onDone={() => setDrawMode(null)} />` and `<AreaDisplayLayer area={search.area} />`; pass `onStartAreaDraw={setDrawMode}` to the Omnibox.

- [ ] **Step 4: Verify**

Manual: click the area chip → draw a polygon → chip turns active, Area renders dashed green, searches now restrict to it; empty query + Area + Enter = Map browse (time-ordered hits); clear chip removes the layer and the filter.

- [ ] **Step 5: Commit**

```bash
git add frontend/src
git commit -m "[UI] Draw Areas directly on the Map home (terra-draw)"
```

### Task 12: Results rail + map pins

**Files:**
- Create: `frontend/src/components/search/results-rail.tsx`, `frontend/src/components/map/result-pins-layer.tsx`
- Modify: `frontend/src/pages/map-home.tsx`

- [ ] **Step 1: Results rail**

`frontend/src/components/search/results-rail.tsx` — horizontal strip, progressive reveal, load-more:

```tsx
import { useEffect, useRef, useState } from "react";

import type { SearchResult } from "../../api/types";
import { AuthImage } from "../ui/auth-image";

const PAGE = 20;

interface ResultsRailProps {
  results: SearchResult[];
  selectedIndex: number | null;
  onSelect: (index: number) => void;
  /** Re-query with a larger top_k; omit to hide the button. */
  onLoadMore?: () => void;
  isSearching: boolean;
  className?: string;
}

export function ResultsRail({
  results,
  selectedIndex,
  onSelect,
  onLoadMore,
  isSearching,
  className,
}: ResultsRailProps) {
  const [visible, setVisible] = useState(PAGE);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => setVisible(PAGE), [results]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) setVisible((v) => Math.min(v + PAGE, results.length));
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [results.length]);

  if (results.length === 0) return null;

  return (
    <div
      className={
        "flex items-stretch gap-2 overflow-x-auto rounded-lg border border-[var(--line)] bg-[var(--panel)]/95 p-2 shadow-lg backdrop-blur " +
        (className ?? "")
      }
    >
      {results.slice(0, visible).map((result, i) => (
        <button
          key={`${result.file_path}-${i}`}
          className={
            "relative h-20 w-28 flex-none overflow-hidden rounded " +
            (i === selectedIndex ? "ring-2 ring-amber-400" : "ring-1 ring-white/10")
          }
          onClick={() => onSelect(i)}
          title={`${result.source_bag} · ${result.timestamp_ns}`}
        >
          <AuthImage filePath={result.file_path} alt={result.source_bag} className="h-full w-full object-cover" />
          {result.similarity_score !== undefined ? (
            <span className="absolute bottom-0 right-0 rounded-tl bg-black/70 px-1 text-[10px]">
              {result.similarity_score.toFixed(2)}
            </span>
          ) : null}
          {result.lat === undefined ? (
            <span className="absolute left-0 top-0 rounded-br bg-black/70 px-1 text-[10px]" title="No Frame location">
              ⚠
            </span>
          ) : null}
        </button>
      ))}
      <div ref={sentinelRef} className="w-1 flex-none" />
      {visible >= results.length && onLoadMore ? (
        <button
          className="flex-none self-center rounded border border-[var(--line)] px-3 py-2 text-xs"
          onClick={onLoadMore}
          disabled={isSearching}
        >
          {isSearching ? "loading…" : "more"}
        </button>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Pins layer (clustered)**

`frontend/src/components/map/result-pins-layer.tsx`:

```tsx
import maplibregl from "maplibre-gl";
import { useEffect, useRef } from "react";

import type { SearchResult } from "../../api/types";
import { useMap, whenStyleReady } from "./maplibre-map";

interface ResultPinsLayerProps {
  results: SearchResult[];
  onPinClick: (resultIndex: number) => void;
}

export function ResultPinsLayer({ results, onPinClick }: ResultPinsLayerProps) {
  const map = useMap();
  const clickRef = useRef(onPinClick);
  clickRef.current = onPinClick;

  useEffect(() => {
    whenStyleReady(map, () => {
      const data: GeoJSON.FeatureCollection = {
        type: "FeatureCollection",
        features: results.flatMap((r, i) =>
          r.lat !== undefined && r.lon !== undefined
            ? [{
                type: "Feature" as const,
                properties: { resultIndex: i },
                geometry: { type: "Point" as const, coordinates: [r.lon, r.lat] },
              }]
            : [],
        ),
      };
      const source = map.getSource("result-pins") as maplibregl.GeoJSONSource | undefined;
      if (source) {
        source.setData(data);
        return;
      }
      map.addSource("result-pins", { type: "geojson", data, cluster: true, clusterRadius: 40 });
      map.addLayer({
        id: "result-pins-clusters",
        type: "circle",
        source: "result-pins",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": "#ffb84d",
          "circle-opacity": 0.85,
          "circle-radius": ["step", ["get", "point_count"], 12, 10, 16, 50, 22],
        },
      });
      map.addLayer({
        id: "result-pins-count",
        type: "symbol",
        source: "result-pins",
        filter: ["has", "point_count"],
        layout: { "text-field": ["get", "point_count_abbreviated"], "text-size": 11 },
      });
      map.addLayer({
        id: "result-pins-point",
        type: "circle",
        source: "result-pins",
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-color": "#ffb84d",
          "circle-radius": 7,
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff",
        },
      });
      map.on("click", "result-pins-point", (e) => {
        const f = e.features?.[0];
        if (f) clickRef.current(f.properties.resultIndex as number);
      });
      map.on("click", "result-pins-clusters", async (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const src = map.getSource("result-pins") as maplibregl.GeoJSONSource;
        const zoom = await src.getClusterExpansionZoom(f.properties.cluster_id as number);
        map.easeTo({ center: (f.geometry as GeoJSON.Point).coordinates as [number, number], zoom });
      });
      for (const layer of ["result-pins-point", "result-pins-clusters"]) {
        map.on("mouseenter", layer, () => (map.getCanvas().style.cursor = "pointer"));
        map.on("mouseleave", layer, () => (map.getCanvas().style.cursor = ""));
      }
    });
  }, [map, results]);

  return null;
}
```

- [ ] **Step 3: Wire into the page**

In `map-home.tsx`: `const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);` render `<ResultPinsLayer results={search.results} onPinClick={setLightboxIndex} />` inside the map, and `<ResultsRail results={search.results} selectedIndex={lightboxIndex} onSelect={setLightboxIndex} onLoadMore={search.loadMore} isSearching={search.isSearching} className="absolute inset-x-4 bottom-4 z-10" />` outside it.

- [ ] **Step 4: Verify**

Manual: search → orange pins on Tracks + rail below; ⚠ badge on rail cards that have no Frame location; cluster click zooms; rail scroll reveals more; "more" re-queries with doubled top-k.

- [ ] **Step 5: Commit**

```bash
git add frontend/src
git commit -m "[UI] Results rail and clustered map pins"
```

### Task 13: Lightbox on the Map home

**Files:**
- Modify: `frontend/src/components/search/sample-result-lightbox.tsx`, `frontend/src/pages/map-home.tsx`

- [ ] **Step 1: Extend the lightbox props**

In `sample-result-lightbox.tsx` add two optional props and render them in the action bar (next to the existing open-link and use-as-support actions):

```tsx
interface SampleResultLightboxProps {
  results: SearchResult[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  fetchHeatmap?: (targetFilePath: string) => Promise<HeatmapResponse | null>;
  getResultHref: (result: SearchResult) => string;
  onUseAsRegionSupport: (result: SearchResult) => void;
  onExtract?: (result: SearchResult) => void;     // NEW: opens the extract dialog (Task 16)
  onOpenInBag?: (result: SearchResult) => void;   // NEW: navigate carrying the result set
}
```

Where the component currently renders the `getResultHref` link, render a button calling `onOpenInBag(result)` when the prop is provided (keep the href fallback). Add an "Extract…" button when `onExtract` is provided.

- [ ] **Step 2: Mount on the Map home**

In `map-home.tsx`:

```tsx
{lightboxIndex !== null && search.results[lightboxIndex] ? (
  <SampleResultLightbox
    results={search.results}
    index={lightboxIndex}
    onIndexChange={setLightboxIndex}
    onClose={() => setLightboxIndex(null)}
    fetchHeatmap={search.activeKind === "region" ? search.fetchHeatmap : undefined}
    getResultHref={(r) => `/bags/${encodeBagId(r.bag_path)}?t=${r.timestamp_ns}`}
    onUseAsRegionSupport={(r) => {
      search.setSupport({ kind: "frame", filePath: r.file_path });
      setLightboxIndex(null);
    }}
    onOpenInBag={(r) =>
      navigate(`/bags/${encodeBagId(r.bag_path)}?t=${r.timestamp_ns}`, {
        state: { results: search.results },
      })
    }
  />
) : null}
```

(`onExtract` is wired in Task 16.) After `onUseAsRegionSupport`, open the support dialog so the user can place points — lift `supportDialogOpen` state from the Omnibox up into the page (pass `supportDialogOpen`/`setSupportDialogOpen` as Omnibox props) or expose an imperative `openSupportDialog` callback prop on Omnibox; pick whichever is smaller in the actual code.

- [ ] **Step 3: Verify**

Manual: click pin/card → lightbox with full Sample, hit Frame highlighted; ←/→ walks results; heatmap toggle works on Region hits; "use as Region support" seeds the canvas with that Frame; "open in bag" lands on the (legacy, until Phase 4) detail page.

- [ ] **Step 4: Commit**

```bash
git add frontend/src
git commit -m "[UI] Sample lightbox over the Map home with open-in-bag handoff"
```

---

## Phase 4 — Bag viewer

### Task 14: Layout lib v2 (fine snap-grid, migration, overlap seeding)

**Files:**
- Modify: `frontend/src/lib/sample-camera-layout.ts`

- [ ] **Step 1: Add v2 types and functions** (keep all v1 exports — legacy viewer still uses them until Phase 6):

```typescript
export const GRID_COLS = 12;
export const TILE_DEFAULT_H = 4; // grid rows per tile (rowHeight set by the viewer)

export interface CameraTile {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CameraLayoutV2 {
  version: 2;
  cameras: string[];
  tiles: Record<string, CameraTile>;
}

const KEY_PREFIX = "sample-camera-layout:";

export function defaultLayoutV2(cameras: string[]): CameraLayoutV2 {
  const { cols } = defaultGridDimensions(cameras.length);
  const w = Math.max(1, Math.floor(GRID_COLS / cols));
  const tiles: Record<string, CameraTile> = {};
  cameras.forEach((camera, i) => {
    tiles[camera] = {
      x: (i % cols) * w,
      y: Math.floor(i / cols) * TILE_DEFAULT_H,
      w,
      h: TILE_DEFAULT_H,
    };
  });
  return { version: 2, cameras: [...cameras].sort(), tiles };
}

function migrateV1(v1: CameraLayout): CameraLayoutV2 {
  const { cols } = layoutDimensions(v1);
  const w = Math.max(1, Math.floor(GRID_COLS / cols));
  const tiles: Record<string, CameraTile> = {};
  for (const [camera, slot] of Object.entries(v1.slots)) {
    tiles[camera] = { x: slot.col * w, y: slot.row * TILE_DEFAULT_H, w, h: TILE_DEFAULT_H };
  }
  return { version: 2, cameras: [...v1.cameras].sort(), tiles };
}

function parseStored(raw: string | null): CameraLayoutV2 | CameraLayout | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { version?: number };
    if (parsed.version === 2) return parsed as CameraLayoutV2;
    if (parsed.version === 1) return parsed as CameraLayout;
  } catch {
    /* corrupt entry */
  }
  return null;
}

function maxOccupiedY(layout: CameraLayoutV2): number {
  return Object.values(layout.tiles).reduce((m, t) => Math.max(m, t.y + t.h), 0);
}

/** Seed a layout for an unseen camera-set from the saved layout with the largest overlap. */
export function seedFromBestOverlap(cameras: string[]): CameraLayoutV2 | null {
  let best: { layout: CameraLayoutV2; overlap: number } | null = null;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(KEY_PREFIX)) continue;
    const stored = parseStored(localStorage.getItem(key));
    if (!stored) continue;
    const v2 = stored.version === 2 ? stored : migrateV1(stored);
    const overlap = v2.cameras.filter((c) => cameras.includes(c)).length;
    if (overlap > 0 && (!best || overlap > best.overlap)) best = { layout: v2, overlap };
  }
  if (!best) return null;
  const seeded: CameraLayoutV2 = { version: 2, cameras: [...cameras].sort(), tiles: {} };
  for (const camera of cameras) {
    if (best.layout.tiles[camera]) seeded.tiles[camera] = { ...best.layout.tiles[camera] };
  }
  let nextY = maxOccupiedY(seeded);
  let nextX = 0;
  for (const camera of cameras) {
    if (seeded.tiles[camera]) continue; // shared cameras keep their spots
    const w = 3;
    if (nextX + w > GRID_COLS) {
      nextX = 0;
      nextY += TILE_DEFAULT_H;
    }
    seeded.tiles[camera] = { x: nextX, y: nextY, w, h: TILE_DEFAULT_H };
    nextX += w;
  }
  return seeded;
}

export function readCameraLayoutV2(cameras: string[]): CameraLayoutV2 {
  const stored = parseStored(localStorage.getItem(cameraLayoutStorageKey(cameras)));
  if (stored) return stored.version === 2 ? stored : migrateV1(stored);
  return seedFromBestOverlap(cameras) ?? defaultLayoutV2(cameras);
}

export function saveCameraLayoutV2(layout: CameraLayoutV2): void {
  localStorage.setItem(cameraLayoutStorageKey(layout.cameras), JSON.stringify(layout));
}
```

- [ ] **Step 2: Verify**

`npm run lint && npm run build` — Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/sample-camera-layout.ts
git commit -m "[Frontend] Camera layout v2: fine snap-grid tiles with overlap seeding"
```

### Task 15: `SampleGridViewer` + Bag viewer page rebuild

**Files:**
- Create: `frontend/src/components/samples/sample-grid-viewer.tsx`, `frontend/src/components/samples/timeline-bar.tsx`, `frontend/src/pages/bag-viewer.tsx`
- Modify: `frontend/src/router.tsx`

- [ ] **Step 1: Grid viewer**

`frontend/src/components/samples/sample-grid-viewer.tsx`:

```tsx
import { useMemo, useState } from "react";
import GridLayout, { WidthProvider, type Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

import type { HeatmapResponse, SampleInfo } from "../../api/types";
import {
  GRID_COLS,
  readCameraLayoutV2,
  saveCameraLayoutV2,
  type CameraLayoutV2,
} from "../../lib/sample-camera-layout";
import { AuthImage } from "../ui/auth-image";
import { HeatmapOverlay } from "../search/heatmap-overlay";

const Grid = WidthProvider(GridLayout);

interface SampleGridViewerProps {
  cameras: string[];
  sample: SampleInfo | null;
  editMode?: boolean;
  heatmaps?: Record<string, HeatmapResponse | undefined>;
  showHeatmaps?: boolean;
  heatmapOpacity?: number;
  className?: string;
}

export function SampleGridViewer({
  cameras,
  sample,
  editMode = false,
  heatmaps,
  showHeatmaps = false,
  heatmapOpacity = 0.6,
  className,
}: SampleGridViewerProps) {
  const [layout, setLayout] = useState<CameraLayoutV2>(() => readCameraLayoutV2(cameras));
  const [maximized, setMaximized] = useState<string | null>(null);

  // Re-read when the camera set changes (different bag opened through the same mount)
  const camKey = [...cameras].sort().join("|");
  useMemo(() => setLayout(readCameraLayoutV2(cameras)), [camKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const rglLayout: Layout[] = cameras.map((camera) => ({
    i: camera,
    ...((layout.tiles[camera] ?? { x: 0, y: 0, w: 3, h: 4 })),
  }));

  function onLayoutChange(next: Layout[]) {
    if (!editMode) return;
    const tiles = { ...layout.tiles };
    for (const item of next) tiles[item.i] = { x: item.x, y: item.y, w: item.w, h: item.h };
    const updated: CameraLayoutV2 = { ...layout, tiles };
    setLayout(updated);
    saveCameraLayoutV2(updated);
  }

  function tile(camera: string) {
    const frame = sample?.frames_by_camera[camera] ?? null;
    return (
      <div
        key={camera}
        className="relative overflow-hidden rounded border border-[var(--line)] bg-black"
        onDoubleClick={() => setMaximized(maximized === camera ? null : camera)}
      >
        {frame ? (
          <AuthImage filePath={frame.file_path} alt={camera} className="h-full w-full object-contain" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs opacity-40">no frame</div>
        )}
        {frame && showHeatmaps && heatmaps?.[frame.file_path] ? (
          <HeatmapOverlay
            heatmap={heatmaps[frame.file_path]!}
            opacity={heatmapOpacity}
            className="absolute inset-0"
          />
        ) : null}
        {frame?.is_focus ? <div className="pointer-events-none absolute inset-0 ring-2 ring-amber-400" /> : null}
        <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[10px] opacity-80">
          {camera}
        </span>
      </div>
    );
  }

  if (maximized) {
    return (
      <div className={"relative h-full " + (className ?? "")}>{tile(maximized)}</div>
    );
  }

  return (
    <div className={"h-full overflow-y-auto " + (className ?? "")}>
      <Grid
        layout={rglLayout}
        cols={GRID_COLS}
        rowHeight={56}
        margin={[6, 6]}
        compactType={null}
        preventCollision
        allowOverlap={false}
        isDraggable={editMode}
        isResizable={editMode}
        onLayoutChange={onLayoutChange}
      >
        {cameras.map((camera) => tile(camera))}
      </Grid>
    </div>
  );
}
```

- [ ] **Step 2: Timeline bar**

`frontend/src/components/samples/timeline-bar.tsx` — normalized time axis with hit pins. **Nanosecond rule (spec):** never compare `timestamp_ns` for equality; always nearest/tolerance. Positions are fractions, so `Number` precision is fine for display.

```tsx
import { ChevronLeft, ChevronRight } from "lucide-react";

import type { SampleInfo, SearchResult } from "../../api/types";

interface TimelineBarProps {
  samples: SampleInfo[];
  selectedIndex: number;
  firstNs: number; // bag first timestamp (from /api/bags/info)
  lastNs: number;
  pins: SearchResult[]; // hits in this bag
  onSelectSample: (index: number) => void;
  onPinClick: (pin: SearchResult) => void;
  onLoadLeft: () => void;
  onLoadRight: () => void;
  canLoadLeft: boolean;
  canLoadRight: boolean;
}

function frac(ns: number, first: number, last: number): number {
  if (last <= first) return 0;
  return Math.min(1, Math.max(0, (ns - first) / (last - first)));
}

export function TimelineBar(props: TimelineBarProps) {
  const windowStart = props.samples.length ? frac(props.samples[0].timestamp_ns, props.firstNs, props.lastNs) : 0;
  const windowEnd = props.samples.length
    ? frac(props.samples[props.samples.length - 1].timestamp_ns, props.firstNs, props.lastNs)
    : 0;
  const cursor =
    props.samples[props.selectedIndex] !== undefined
      ? frac(props.samples[props.selectedIndex].timestamp_ns, props.firstNs, props.lastNs)
      : 0;

  return (
    <div className="flex items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--panel)]/95 px-2 py-1.5">
      <button onClick={props.onLoadLeft} disabled={!props.canLoadLeft} aria-label="Load earlier">
        <ChevronLeft className="h-4 w-4" />
      </button>
      <div className="relative h-6 min-w-0 flex-1">
        <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded bg-white/15" />
        <div
          className="absolute top-1/2 h-1 -translate-y-1/2 rounded bg-white/40"
          style={{ left: `${windowStart * 100}%`, width: `${Math.max(0.5, (windowEnd - windowStart) * 100)}%` }}
        />
        <div className="absolute top-0 h-full w-0.5 bg-sky-400" style={{ left: `${cursor * 100}%` }} />
        {props.pins.map((pin, i) => (
          <button
            key={`${pin.file_path}-${i}`}
            className="absolute top-0 h-2.5 w-2.5 -translate-x-1/2 rounded-full border border-white/50 bg-amber-400"
            style={{ left: `${frac(pin.timestamp_ns, props.firstNs, props.lastNs) * 100}%` }}
            title={pin.similarity_score?.toFixed(2)}
            onClick={() => props.onPinClick(pin)}
          />
        ))}
      </div>
      <button onClick={props.onLoadRight} disabled={!props.canLoadRight} aria-label="Load later">
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Bag viewer page**

`frontend/src/pages/bag-viewer.tsx` — full-bleed page on `useSampleBrowser` (verified API: `openForBag`, `samples`, `selectedSampleIndex`, `activeSample`, `cameras`, `jumpToTimestamp`, `selectNextSample`, `selectPreviousSample`, `loadMoreLeft/Right`, `canLoadMoreLeft/Right`, `setSelectedTimestampNs`). Ignore its chat-related fields (deleted in Phase 6).

```tsx
import { Pencil } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLocation, useParams, useSearchParams } from "react-router-dom";

import { SampleGridViewer } from "../components/samples/sample-grid-viewer";
import { TimelineBar } from "../components/samples/timeline-bar";
import { useSampleBrowser } from "../hooks/use-sample-browser";
import type { SearchResult } from "../api/types";

export function BagViewerPage() {
  const { bagId } = useParams();
  const [params] = useSearchParams();
  const location = useLocation();
  const browser = useSampleBrowser();
  const [editMode, setEditMode] = useState(false);
  const [bagRange, setBagRange] = useState<{ first: number; last: number } | null>(null);

  const bagPath = useMemo(() => (bagId ? decodeBagId(bagId) : null), [bagId]); // same codec as Task 7
  const bagName = bagPath ? bagPath.replace(/\/+$/, "").split("/").pop()! : "";

  // Hit pins handed off from the Map home lightbox ("open in bag")
  const handedResults = (location.state as { results?: SearchResult[] } | null)?.results ?? [];
  const pins = handedResults.filter((r) => r.bag_path === bagPath);

  useEffect(() => {
    if (!bagPath) return;
    // /api/bags/info gives first/last timestamps — reuse the existing client function
    // (see how the legacy BagDetailPage fetches it) and then open the browser window.
    void (async () => {
      const info = await fetchBagInfo(bagPath); // existing client fn for GET /api/bags/info
      setBagRange({ first: info.first_timestamp_ns, last: info.last_timestamp_ns });
      const t = params.get("t"); // kept as a string until the last moment
      await browser.openForBag({
        bagPath,
        bagName,
        startNs: t !== null ? Number(t) : info.first_timestamp_ns,
      });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bagPath]);

  if (!bagPath) return null;

  return (
    <div className="absolute inset-0 flex flex-col gap-2 p-3">
      <div className="flex items-center justify-between">
        <h1 className="truncate text-sm font-semibold">{bagName}</h1>
        <div className="flex items-center gap-2">
          <button
            className={
              "flex items-center gap-1 rounded border px-2 py-1 text-xs " +
              (editMode ? "border-sky-400 bg-sky-400/15" : "border-[var(--line)]")
            }
            onClick={() => setEditMode(!editMode)}
          >
            <Pencil className="h-3 w-3" /> layout
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        <SampleGridViewer cameras={browser.cameras} sample={browser.activeSample} editMode={editMode} />
      </div>

      {bagRange ? (
        <TimelineBar
          samples={browser.samples}
          selectedIndex={browser.selectedSampleIndex}
          firstNs={bagRange.first}
          lastNs={bagRange.last}
          pins={pins}
          onSelectSample={(i) => {
            const s = browser.samples[i];
            if (s) browser.setSelectedTimestampNs(s.timestamp_ns);
          }}
          onPinClick={(pin) => void browser.jumpToTimestamp(pin.timestamp_ns)}
          onLoadLeft={() => void browser.loadMoreLeft()}
          onLoadRight={() => void browser.loadMoreRight()}
          canLoadLeft={browser.canLoadMoreLeft}
          canLoadRight={browser.canLoadMoreRight}
        />
      ) : null}
    </div>
  );
}
```

Add keyboard navigation: `useEffect` keydown listener — `ArrowLeft` → `browser.selectPreviousSample()`, `ArrowRight` → `browser.selectNextSample()`. Find `fetchBagInfo`'s actual exported name and response field names in `frontend/src/api/client.ts` / the legacy `BagDetailPage`.

- [ ] **Step 4: Route it**

In `router.tsx`, move `bags/:bagId` out of the legacy `BagsLayout` into the `FullBleedLayout` children: `{ path: "bags/:bagId", element: <BagViewerPage /> }`. Keep the legacy detail page reachable at `bags-legacy/:bagId` only if you want a comparison during QA — otherwise delete the route now (the page file is deleted in Phase 6).

- [ ] **Step 5: Verify**

`npm run lint && npm run build`. Manual: open a bag from a Track or panel; drag/resize tiles in layout mode (gaps allowed, no overlap, persists across reload); double-click maximizes; arrows scrub without tile reflow (placeholders for missing cameras); "open in bag" from a search shows amber pins on the timeline; clicking a pin jumps to that Sample with the hit Frame ringed.

- [ ] **Step 6: Commit**

```bash
git add frontend/src
git commit -m "[UI] Bag viewer: free snap-grid Sample browsing with timeline pins"
```

### Task 16: Scoped Omnibox in the viewer + extract dialog

**Files:**
- Create: `frontend/src/components/extract/extract-dialog.tsx`
- Modify: `frontend/src/pages/bag-viewer.tsx`, `frontend/src/pages/map-home.tsx`, `frontend/src/api/client.ts`

- [ ] **Step 1: Extract dialog**

`frontend/src/components/extract/extract-dialog.tsx` (Radix Dialog, same idiom as existing dialogs under `components/ui/`; submit via a `submitExtraction` client function — check `client.ts` first: the workspace extraction UI already has one; reuse it, otherwise add `export function submitExtraction(req: ExtractionSubmitRequest) { return http<ExtractionSubmitResponse>("/api/datasets/extract", { method: "POST", body: JSON.stringify(req) }); }`):

```tsx
import { useState } from "react";
import { toast } from "sonner";

import { submitExtraction } from "../../api/client";

interface ExtractDialogProps {
  bagPath: string;
  timestampNs: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ExtractDialog({ bagPath, timestampNs, open, onOpenChange }: ExtractDialogProps) {
  const [windowLengthS, setWindowLengthS] = useState(10);
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  async function onSubmit() {
    setSubmitting(true);
    try {
      const resp = await submitExtraction({
        bag_path: bagPath,
        mode: "window",
        timestamp_ns: timestampNs,
        window_length_s: windowLengthS,
        user_config: {},
      });
      toast.success(`Extraction queued (job ${resp.job_id})`);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Extraction failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => onOpenChange(false)}>
      <div
        className="w-80 rounded-lg border border-[var(--line)] bg-[var(--panel)] p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-3 text-sm font-semibold">Extract window</h2>
        <p className="mb-2 truncate text-xs opacity-70">{bagPath}</p>
        <p className="mb-3 text-xs opacity-70">start: {timestampNs}</p>
        <label className="mb-3 block text-xs">
          window length (s)
          <input
            type="number"
            min={1}
            className="mt-1 w-full rounded border border-[var(--line)] bg-transparent px-2 py-1"
            value={windowLengthS}
            onChange={(e) => setWindowLengthS(Number(e.target.value))}
          />
        </label>
        <div className="flex justify-end gap-2 text-sm">
          <button className="rounded border border-[var(--line)] px-3 py-1" onClick={() => onOpenChange(false)}>
            cancel
          </button>
          <button
            className="rounded bg-sky-500/80 px-3 py-1 disabled:opacity-50"
            onClick={onSubmit}
            disabled={submitting}
          >
            {submitting ? "submitting…" : "extract"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

(If the existing workspace extraction form exposes config-schema-driven fields, keep this minimal window-only dialog anyway — spec scope is "window starting here".)

- [ ] **Step 2: Entry point 1 — the lightbox.** In `map-home.tsx`, add `const [extractTarget, setExtractTarget] = useState<SearchResult | null>(null);`, pass `onExtract={setExtractTarget}` to `SampleResultLightbox`, and render `<ExtractDialog bagPath={extractTarget.bag_path} timestampNs={extractTarget.timestamp_ns} open onOpenChange={() => setExtractTarget(null)} />` when set.

- [ ] **Step 3: Entry point 2 — the viewer.** In `bag-viewer.tsx`, add an "Extract…" button next to the layout toggle that opens `ExtractDialog` with `timestampNs={browser.selectedTimestampNs ?? bagRange.first}`.

- [ ] **Step 4: Scoped Omnibox in the viewer.** In `bag-viewer.tsx`: `const search = useOmniboxSearch({ scope: { bagPaths: bagPath ? [bagPath] : [] } });` render `<Omnibox search={search} showAreaChip={false} showBagChip={false} className="w-[min(640px,80vw)]" />` in the header row; merge `search.results` into the timeline pins (`pins = [...handedPins, ...search.results]`) and render a compact `<ResultsRail results={search.results} … className="max-h-24" />` above the timeline when non-empty, with `onSelect` jumping via `browser.jumpToTimestamp(result.timestamp_ns)`.

- [ ] **Step 5: Verify**

Manual: in-viewer text search drops amber pins on the timeline and a strip above it; clicking either jumps the viewer; Extract… from both the lightbox and the viewer queues a job (toast with job id).

- [ ] **Step 6: Commit**

```bash
git add frontend/src
git commit -m "[UI] Scoped viewer search and extraction entry points"
```

### Task 17: Jobs tab

**Files:**
- Create: `frontend/src/components/map/jobs-tab.tsx`
- Modify: `frontend/src/pages/map-home.tsx`

- [ ] **Step 1: Jobs tab component**

First open `frontend/src/components/layout/top-bar.tsx` and its `JobsDropdown` — it already fetches `/api/datasets/jobs`; reuse its client function and response shape (don't invent a second fetcher). The tab:

```tsx
import { useEffect, useState } from "react";

import { cancelExtractionJob, listExtractionJobs } from "../../api/client"; // reuse JobsDropdown's fns
import type { ExtractionJob } from "../../api/types";

const STATUS_ICON: Record<ExtractionJob["status"], string> = {
  queued: "⏸",
  running: "⏳",
  done: "✓",
  error: "✕",
  cancelled: "⊘",
};

export function JobsTab() {
  const [jobs, setJobs] = useState<ExtractionJob[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      listExtractionJobs()
        .then((j) => {
          if (!cancelled) setJobs(j);
        })
        .catch(() => undefined);
    load();
    const interval = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (jobs.length === 0) return <p className="p-2 text-xs opacity-60">No extraction jobs.</p>;

  return (
    <ul className="space-y-1 text-xs">
      {jobs.map((job) => (
        <li key={job.job_id} className="rounded border border-[var(--line)] p-2">
          <div className="flex items-center justify-between">
            <span className="truncate">{job.bag_path.split("/").pop()}</span>
            <span>
              {STATUS_ICON[job.status]} {job.status}
            </span>
          </div>
          <div className="mt-1 flex items-center justify-between opacity-70">
            <span>{job.window_length_s ? `${job.window_length_s}s window` : job.mode}</span>
            {job.status === "queued" || job.status === "running" ? (
              <button className="underline" onClick={() => void cancelExtractionJob(job.job_id)}>
                cancel
              </button>
            ) : null}
          </div>
          {job.error_message ? <p className="mt-1 text-red-400">{job.error_message}</p> : null}
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 2: Wire it.** In `map-home.tsx`, pass `jobsTab={<JobsTab />}` to `MapSidePanel`. The existing `JobsDropdown` in the TopBar stays — it is the cross-surface badge the spec asks for.

- [ ] **Step 3: Verify.** Queue an extraction → Jobs tab shows it progressing; cancel works; TopBar badge reflects the running job on both surfaces.

- [ ] **Step 4: Commit**

```bash
git add frontend/src
git commit -m "[UI] Jobs tab in the Map home side panel"
```

---

## Phase 5 — Legacy deletion & docs

### Task 18: Swap the lightbox's viewer and retire `SampleViewer`

**Files:**
- Modify: `frontend/src/components/search/sample-result-lightbox.tsx`

- [ ] **Step 1:** Replace the lightbox's internal `SampleViewer` usage with `SampleGridViewer` (read-only: no `editMode`; pass through `heatmaps`/`showHeatmaps`/`heatmapOpacity` — props match by design). Map the lightbox's existing heatmap state to the `heatmaps` record keyed by `file_path`.
- [ ] **Step 2:** Verify: lightbox on the Map home still shows the full Sample with hit ring + heatmap toggle. `npm run lint && npm run build`.
- [ ] **Step 3:** Commit: `git commit -am "[UI] Lightbox renders the snap-grid Sample viewer"`.

### Task 19: Delete legacy pages, components, and the Leaflet stack

**Files (delete):**
- `frontend/src/pages/dashboard.tsx`, `frontend/src/pages/workspace.tsx`, `frontend/src/pages/search.tsx`
- `frontend/src/pages/bags/bags-list-page.tsx`, `frontend/src/pages/bags/bags-layout.tsx`, `frontend/src/pages/bags/bag-detail-page.tsx`
- `frontend/src/components/search/map-area-dialog.tsx`, `search-mode-toggle.tsx`, `results-grid.tsx`, `sequence-viewer.tsx`, `search-bar.tsx`, `image-card.tsx` (if only the grid used it)
- `frontend/src/components/samples/sample-viewer.tsx`, `frontend/src/components/bags/bag-sample-browser.tsx`
- `frontend/src/components/map/area-layer.tsx`, `bag-trajectories.tsx` (Leaflet versions)
- v1-only functions in `frontend/src/lib/sample-camera-layout.ts` that no longer have callers (`swapCameraSlots`, `readCameraLayout`, `saveCameraLayout`, `clearCameraLayout` — keep `defaultGridDimensions`, `layoutDimensions`, `cameraLayoutStorageKey`, the v1 types used by `migrateV1`)

- [ ] **Step 1:** Delete the files above, remove their routes/imports from `router.tsx` (final route table: `/login`; FullBleedLayout: index → `MapHomePage`, `bags/:bagId` → `BagViewerPage`, `*` → redirect `/`). `MainLayout`, `Sidebar`, `sidebar-slot.tsx` and any workspace-only chat/extraction panels lose all callers — delete them too (`grep -rl "useSidebar\|MainLayout" frontend/src` to confirm). Trim the chat fields from `use-sample-browser.ts` (`chatDuration`, `chatQuery`, `chatResponse`, `isChatting`, `runChat`, `setChatDuration`, `setChatQuery`, `isSampleInVlmWindow`, `vlmWindowStartNs`, `vlmWindowEndNs`) and delete the chat client functions from `api/client.ts` (`ChatRequest` etc.). Keep the backend `/api/chat` router untouched.
- [ ] **Step 2:** `cd frontend && npm uninstall leaflet react-leaflet @geoman-io/leaflet-geoman-free leaflet.markercluster` (and `@types/leaflet*` dev deps if present).
- [ ] **Step 3:** `npm run lint && npm run build` — fix every dangling import the compiler finds. Run the full backend suite too: `PYTHONPATH="" uv run pytest tests/ -v` — Expected: PASS (frontend deletion can't break it; this is the regression gate).
- [ ] **Step 4:** Manual smoke pass of the whole spec checklist: every Omnibox mode row, Area compose, browse, lightbox nav + 3 actions, viewer layout edit/persist/seed, scoped search, extraction from both entry points, jobs tab, no-GPS bag reachable from panel and searchable.
- [ ] **Step 5:** Commit:

```bash
git add -A frontend
git commit -m "[UI] Delete legacy pages, chat UI, and the Leaflet stack"
```

### Task 20: Documentation

**Files:**
- Modify: `CLAUDE.md` (Frontend Structure section + roadmap status), `CONTEXT.md` (none expected — vocabulary already canonicalized)

- [ ] **Step 1:** Rewrite CLAUDE.md's "Frontend Structure" section to describe the shipped reality: two surfaces, FullBleedLayout, Omnibox/side-panel/rail/lightbox component map, layout-v2 localStorage persistence; mark the redesign as shipped in the roadmap section and bump "Last Updated".
- [ ] **Step 2:** Commit: `git add CLAUDE.md && git commit -m "[Docs] Record shipped map-first frontend"`.

---

## Self-review checklist (run before declaring the plan done)

- Spec coverage: batch tracks (T1), hit locations (T2), top_k (T3), image auth (T4), MapLibre+globe+OpenFreeMap (T7, ADR 0007), side panel + no-GPS bags (T8), Omnibox mode table (T9–T10), Area on main map (T11), rail + pins + no-silent-drop (T12), lightbox flow + 3 actions (T13, T16), snap-grid + seeding + stable placeholders (T14–T15), ns-tolerance rule (T15), scoped search (T16), extraction both entry points (T16), jobs surface (T17), deletions (T19), docs (T20).
- Known soft spots an executor must resolve against real code (flagged inline): `encodeBagId` helper name (T7), `useUrlSearch` map-browse/topK-rerun wiring (T9), `BagPickerChip`/`FilterChip`/`RegionSupportDialog` prop names (T10), terra-draw `finish` event signature (T11), `fetchBagInfo` name/fields (T15), jobs client function names (T17), CSS variable names (T8).
