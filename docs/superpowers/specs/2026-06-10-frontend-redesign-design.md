# Map-First Frontend Redesign — Design

**Date**: 2026-06-10
**Status**: Approved (brainstorming session with visual mockups in `.superpowers/brainstorm/`)
**Supersedes**: the Phase 2–4 WorkspacePage carve-out roadmap in `CLAUDE.md`; the page-level IA of `2026-04-24-bag-explorer-design.md` and `2026-04-28-search-page-design.md` (their component-level designs — point canvas, heatmaps, lightbox, Sample viewer — carry over).

## Motivation

Every retrieval capability already works — Global text/image search, Region search
(by text, by points on a Support image), Area filtering, Map browse, synchronized
multi-camera Samples — but the UI accreted around them: a four-block dashboard,
a `/search` page with a nested map dialog and a mode toggle, a separate `/bags`
list page, and a legacy `/workspace`. The redesign collapses this into a
**map-first, two-surface** information architecture. The VLM chat feature is
deprecated and gets no UI (the backend `/api/chat` router is kept but unexposed).

## Information architecture

| Route | Surface | Purpose |
|---|---|---|
| `/login` | Login | Unchanged. |
| `/` | **Map home** | Fleet map + Omnibox + side panel + Results rail. All cross-bag querying. |
| `/bags/:bagId` | **Bag viewer** | One Bag: free-form Camera layout grid + timeline + scoped Omnibox. |

**Deleted**: DashboardPage (four blocks), WorkspacePage (and all chat UI),
SearchPage, BagsListPage, the `/datasets` stub, `MapAreaDialog`,
`SearchModeToggle`, `ResultsGrid`, `SequenceViewer`, legacy `SearchBar`.
Deletion happens in this effort — no parallel legacy fallback is preserved.

## Surface 1: Map home (`/`)

### Map engine

**MapLibre GL** (v5+, BSD-3, no key) with **OpenFreeMap** vector tiles (free, no
registration) and globe projection at far zoom. Boots zoomed to the fleet's
extent (`fitBounds` over all Tracks — northern Italy today). Area drawing via
**terra-draw** (circle + polygon) directly on this map; the nested map dialog
dies. Supersedes Leaflet — see ADR 0007.

### Tracks

Every indexed Bag's Track is plotted (distinct colors). Hovering a Track or its
side-panel row highlights both. Clicking a Track opens its Bag viewer.
Requires the new batch endpoint (see Backend changes).

### Side panel (collapsible)

- **Bags tab**: every bag found by scan — indexed+located (✓, colored dot
  matching its Track), indexed without GPS (⚠ no GPS, list-only, still fully
  searchable and openable), indexing (⏳ + progress), unindexed (index action).
  Hover row ⇢ Track highlight; click ⇢ Bag viewer. "Scan root" action.
- **Jobs tab**: Extraction jobs — status, logs, cancel (existing
  `/api/datasets` endpoints). A top-bar badge is visible on both surfaces while
  a job runs.

The panel collapses to a button; the old `/bags` list page is gone.

### Omnibox

One query field. **The search mode is implied by what the user attaches —
there is no mode picker.**

| Input | Mode | Endpoint |
|---|---|---|
| Text only | Global text | `POST /api/search` |
| Text + ⊙ Region chip | Region by text | `POST /api/search/region/by-text` |
| Image attached, no points | Global image | `POST /api/search/image` |
| Image attached + points | Region by points | `POST /api/search/region/by-image` |
| Indexed Frame as support + points (from lightbox) | Region by frame | `POST /api/search/region/by-frame` |
| No query, Area set | Map browse | `POST /api/search/map` |

- Attaching an image opens the point canvas (existing `RegionPointCanvas` in a
  dialog); placing points is optional — none means Global image search.
- The ⊙ Region chip is only meaningful for text queries (images self-select via
  points).
- Filter chips compose with any mode: **Area** (draw on the main map, edit/clear
  from the chip), **bags** (subset picker, default all), **⋯ advanced**
  (`top_k`, `min_score`).
- **No more top-k wall**: default `top_k` rises to **100**; the Results rail
  reveals hits progressively as the user scrolls and re-queries with a larger
  `top_k` when the fetched list is exhausted. `min_score` is the quality cutoff;
  both knobs stay tucked behind ⋯.

### Results

- Hits **with a Frame location** appear as pins on the map (clustered when
  dense); **all** hits appear in the bottom Results rail (lazy-loading
  thumbnails, ordered by score; Map browse is time-ordered). A hit without a
  Frame location is rail-only — never silently dropped.
- Clicking a pin or rail card opens the **Lightbox** (existing
  `SampleResultLightbox`, adapted): the full Sample around the hit, hit Frame
  highlighted, heatmap toggle for Region hits, ←/→ steps through the result
  list without losing the query. Actions per hit:
  - **Use as Region support** — seeds a Region query from this Frame
    (point canvas over it, `by-frame` endpoint).
  - **Extract…** — opens the extraction form pre-filled with this Bag and
    timestamp.
  - **Open in bag ↗** — navigates to the Bag viewer at that timestamp with the
    current result set carried along as timeline pins (bag id + timestamp in
    the URL so deep links work; the hit list rides in router state).

Search state (query, chips, results page) lives in the URL where practical, as
today's `useUrlSearch` does, so back/forward and reload behave.

## Surface 2: Bag viewer (`/bags/:bagId`)

### Free-form Camera layout

A **fine snap-grid** (12 columns × open-ended rows): tiles can be dragged
anywhere, corner-resized to any span, **gaps are allowed** (so a layout can
mirror where Cameras are mounted on the vehicle — e.g. fronts across the top,
rears at the bottom, empty cells where the vehicle "is"), **overlap is
forbidden** (no z-order housekeeping). Double-click a tile maximizes it;
double-click again restores. Implementation: `react-grid-layout` with collision
prevention on and vertical compaction off.

### Layout persistence & dynamics

- Layouts stay in **localStorage**, keyed per sorted camera-topic set (today's
  mechanism). No server persistence — each user arranges their own view.
- **New camera-set**: seed from the saved layout with the largest camera
  overlap — shared Cameras keep their positions, new Cameras land in free
  cells; with no overlapping layout saved, fall back to a plain auto-grid.
- **While scrubbing**: a Camera with no Frame near the Sample timestamp shows a
  stable placeholder tile — the layout never reflows during playback/scrubbing.

### Timeline

Anchor-Camera Sample timeline (existing `useSampleBrowser` mechanics) with
clickable **pins** for search hits; clicking a pin jumps the viewer to that
Sample. Timestamps are handled as strings/BigInt end-to-end in new code —
nanosecond epochs exceed 2^53 and lose precision as JS numbers (known issue,
previously worked around; the rebuild fixes it properly in the components it
touches).

### Scoped Omnibox

The same Omnibox component, with the bag chip pinned to the open Bag and the
Area chip absent (there is no map to draw on; geographic narrowing is the Map
home's job). Results land directly as timeline pins plus a small thumbnail
strip — no map detour. Cross-bag search remains the Map home's job.

### Extract…

Always-available action; pre-fills the current Bag and timestamp, user sets the
window, submits to `POST /api/datasets/extract`. Progress lands in the Jobs tab
/ top-bar badge.

## Backend changes

1. **`GET /api/bags/tracks`** (new): all indexed Bags' Tracks in one call,
   decimated for rendering (stride / max-points parameter). The per-bag
   `GET /api/bags/track` stays for the viewer.
2. **Frame location in search responses**: every search endpoint returns each
   hit's (lat, lon) when the Frame has one (nullable) — pins need it; today
   only Map search returns locations.
3. **`top_k` default raised** to 100 server-side to match the frontend.
4. **Auth on `/api/image`** (opportunistic fix of a known gap): the router
   gains `require_current_user`; the frontend already fetches thumbnails
   through `AuthImage` with a Bearer token.

Everything else — region endpoints, samples API, datasets/extraction API,
auth — is consumed as-is.

## Component disposition

| Keep / adapt | Change |
|---|---|
| `SampleViewer` | becomes the free snap-grid (drag/resize/gaps/maximize) |
| `SampleResultLightbox` | hosts the new actions; ←/→ across results |
| `RegionPointCanvas`, `HeatmapOverlay` | as-is |
| `AuthImage`, `api/client.ts` | as-is |
| `useRegionSearch`, `useUrlSearch`, `useSampleBrowser` | adapted to the new surfaces |
| `useMapArea` | re-targeted from geoman to terra-draw |
| `useBagTracks`, `BagTrajectories`, `AreaLayer` | rewritten for MapLibre + batch tracks endpoint |

Deleted components are listed under Information architecture.

## Technology decisions

- **maplibre-gl** + **OpenFreeMap** tiles + **terra-draw** (ADR 0007, supersedes
  ADR 0006's Leaflet choice — which explicitly anticipated this revisit).
- **react-grid-layout** for the viewer grid (collision prevention, no
  compaction). Reversible choice; no ADR.

## Out of scope

- VLM chat UI (backend router retained, unexposed).
- Server-side layout persistence (considered, rejected — per-browser
  localStorage is enough).
- Any change to indexing, embedding, or the region/PQ index.

## Testing

- **Backend**: pytest for the batch tracks endpoint (striding, no-GPS bags
  excluded), Frame location present in search responses, `/api/image` auth
  (401 unauthenticated — fixes the known broken tests around this gap).
- **Frontend**: `npm run lint` + `npm run build`; manual e2e against real bags
  for: each Omnibox mode row in the table above, Area compose, lightbox
  navigation, open-in-bag pin handoff, layout edit/persist/seed, extraction
  from both entry points.

## Build order (sketch for the implementation plan)

1. Backend: batch tracks + location-in-results + top_k default + image auth.
2. Map home shell: MapLibre map, tracks, side panel (Bags tab), routing swap.
3. Omnibox + results (rail, pins, lightbox adaptation).
4. Bag viewer: snap-grid layout + timeline + scoped search.
5. Extraction entry points + Jobs tab.
6. Delete legacy pages/components; update docs.
