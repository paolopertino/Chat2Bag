# Map-home UI improvements — Design

**Date:** 2026-06-15
**Branch:** `feat/frontend-refactor`
**Status:** Approved (pending implementation plan)

## Summary

Five related improvements to the map-first UI, plus the architectural cleanup they
depend on:

1. De-duplicate the bag list (one source of truth), show indexing failures, and
   group bags into a nested, collapsible tree that mirrors the on-disk folder layout.
2. Add a per-bag (and per-group) visibility toggle that excludes hidden bags from
   both similarity search and the map GPS tracks.
3. Make the floating results rail stop obstructing the sidebar and the map controls.
4. Make default similarity thresholds configurable per search type
   (text default `0.14`, visual default `0.80`).
5. Fix global image similarity search so it no longer forces the user to place a
   region point.

A sixth, supporting change exposes the indexing error reason from the backend.

## Background / current state

- **Two independent bag-state instances.** `MapHomePage` calls `useBagsState()`
  directly to drive the sidebar, while `BagPickerChip` and all search read a
  *separate* instance through `useBags()` (the `BagsProvider` mounted in
  `protected-route.tsx`). They scan and poll independently. This is why the list
  feels duplicated and why the omnibox checkbox does not affect the map.
- **Grouping data is already available.** `GET /api/bags/scan` returns each bag's
  absolute `bag_path`, its `bag_name` (folder name), and the resolved `root_dir`.
  Nesting can be derived entirely on the frontend by stripping `root_dir` from
  `bag_path`. No new backend data is required for grouping.
- **Failures are invisible and unrecorded.** `IndexingService.index_bag` catches
  exceptions, sets `status="error"`, and only *logs* the message — it is never
  persisted. Neither `/scan` nor `/status` returns `error_message`, and the
  sidebar's `statusBadge` does not render the `error` state at all.
- **Thresholds are a single client-side value.** `useUrlSearch` keeps one
  `minScore` (default `0`) in the URL and filters results client-side. There is no
  per-type notion and no backend score filtering.
- **Image upload forces region mode.** Uploading an image auto-opens
  `RegionSupportDialog`, whose **Done** button is `disabled` until at least one
  point is placed. Global image search is only reachable by *cancelling* the dialog
  and pressing Enter — effectively hidden, not broken.
- **Rail layout.** The results rail is `absolute inset-x-4 bottom-4` (full width).
  MapLibre's `NavigationControl` is at `bottom-right`, so the rail covers it; the
  rail also hugs the sidebar on the left.
- **Dead code.** `selectedBagPaths` / `toggleBagSelection` / `toggleAllBags` in
  `use-bags.ts` survive only through `components/bags/bag-list.tsx`, which is not
  imported anywhere.

## Decisions (from brainstorming)

- **Bag list:** sidebar is the single source. Remove the omnibox bag-picker chip.
- **Thresholds:** type-aware defaults with **two separate sliders** (text + visual),
  persisted to localStorage; applied automatically based on the active search type.
- **Image upload:** keep auto-opening the point dialog; pressing **Done with zero
  points** runs a global search, with ≥1 point it runs a region search.
- **Visibility:** persisted per-bag, all visible by default; hidden bags excluded
  from both search and map tracks. Group rows also toggle their descendants.
- Dropping the shareable `?bags=` and `?minScore=` URL params is acceptable.

---

## Design

### 0. Shared foundation — one bag state

- `MapHomePage` consumes `useBags()` (context) instead of calling `useBagsState()`
  directly. The sidebar, `useFleetTracks`, and search now read one instance.
- Capture the resolved `root_dir` from the `/scan` response into the bag state
  (e.g. `scannedRoot`), so grouping computes paths relative to the true root rather
  than the user-typed string.

**Affected:** `frontend/src/hooks/use-bags.ts`, `frontend/src/pages/map-home.tsx`.

### 1. Sidebar = single bag manager (nested, grouped, failures shown)

- **Remove** `BagPickerChip` from the omnibox and the `showBagChip` prop from
  `Omnibox`. Both surfaces simply never render a bag chip.
- **Nested tree.** New component `frontend/src/components/map/bag-tree.tsx`:
  - Build a tree from the bag list: for each bag, `rel = bag_path − root_dir`, split
    on `/`. Intermediate segments are **group nodes**; the final segment is the bag
    **leaf**. A bag directly under root is a top-level leaf. Arbitrary depth is
    supported recursively.
  - Group rows are **collapsible** and show a child count, e.g. `▼ 2026-05-19 (2)`.
    Default expanded.
  - Leaf rows preserve current behavior: track-color dot, name, status badge,
    hover→highlight track, click→open bag viewer (when indexed), `index` button.
- **Failures.** Render `status === "error"` as a red `⚠ failed` badge; the error
  message (once exposed by the backend, §6) appears in the row's `title` tooltip.
  Add a **Retry** action that resets and re-indexes:
  `DELETE /api/index?bag_path=…` then `POST /api/index`. Keep existing badges
  (indexing / not indexed / no GPS / ✓).
- `map-side-panel.tsx` keeps the tab header, root-dir input, scan button, and Jobs
  tab; it delegates the list body to `BagTree`.

**Affected:** `frontend/src/components/map/map-side-panel.tsx` (new `bag-tree.tsx`),
`frontend/src/components/omnibox/omnibox.tsx`,
`frontend/src/api/client.ts` (a `resetIndex` helper if not already present).

### 2. Per-bag / per-group visibility toggle

- Add `hiddenBagPaths` to the unified bag state, persisted to localStorage
  (key `bag_gpt_hidden_bags`), with helpers `toggleBagVisibility(path)`,
  `setBagsHidden(paths, hidden)` (for group toggles), and a derived
  `visibleIndexedBagPaths`.
- All bags visible by default (a path absent from the set = visible).
- **Eye toggle** on each leaf row; group rows show a toggle reflecting their
  descendants (visible / hidden / mixed) and flip them all.
- **Hidden ⇒ excluded** from:
  - fleet tracks — `MapHomePage` passes `visibleIndexedBagPaths` to
    `useFleetTracks`;
  - search scope — see §3 (search now reads visible indexed bags).
- Remove dead `selectedBagPaths` / `toggleBagSelection` / `toggleAllBags` and the
  unused `components/bags/bag-list.tsx`.

**Affected:** `frontend/src/hooks/use-bags.ts`, `frontend/src/pages/map-home.tsx`,
`frontend/src/components/map/bag-tree.tsx`, delete `components/bags/bag-list.tsx`.

### 3. Search scope follows visibility

- `useUrlSearch`: drop the URL `bags` param handling (`parseBags`,
  `decodeBagIds`, `urlBags`, `setBags`). `effectiveBagPaths = options.scope?.bagPaths
  ?? visibleIndexedBagPaths` (from `useBags()`).
- `useOmniboxSearch`: remove `urlBags` / `setBags` from its returned interface.
- The bag viewer is unaffected — it passes an explicit single-bag `scope`.

**Affected:** `frontend/src/hooks/use-url-search.ts`,
`frontend/src/hooks/use-omnibox-search.ts`.

### 4. Less-obstructing results rail

- Lift the sidebar open/collapsed state from `MapSidePanel` up to `MapHomePage`
  (passed back down as `open` + `onOpenChange`).
- Re-layout `ResultsRail` on the map home from `inset-x-4 bottom-4` to:
  - **left**: ~`21rem` when the sidebar is open (clears `left-4` + `w-72`), small
    inset (~`left-16`) when collapsed;
  - **right**: ~`right-14` so it never overlaps the bottom-right zoom / attribution
    controls.
- The bag-viewer rail (a normal flex child) is unchanged.

**Affected:** `frontend/src/pages/map-home.tsx`,
`frontend/src/components/map/map-side-panel.tsx`.

### 5. Configurable per-type thresholds

- New `frontend/src/hooks/use-search-thresholds.ts`: `{ text, visual, setText,
  setVisual }`, persisted to localStorage (keys `bag_gpt_threshold_text` = `0.14`,
  `bag_gpt_threshold_visual` = `0.80` by default), each clamped to `[0, 1]`.
- `FilterChip` shows **two sliders** — "Text min" and "Visual min" — wired to the
  hook, replacing the single `minScore` slider. The collapsed chip shows the
  **active** threshold based on the current search modality (e.g. `≥0.80`).
- `useOmniboxSearch` tracks the last-submitted **modality**:
  - `text` — global text search and region-by-text;
  - `visual` — image upload, similar, region-by-image, region-by-frame;
  - map-browse rows carry no `similarity_score`, so the filter (`score ?? 1 >= t`)
    leaves them untouched regardless of modality.
  The active threshold = `modality === "visual" ? visual : text`, applied as the
  single client-side score filter over the merged results.
- `useUrlSearch` stops owning the threshold: it returns **raw** results +
  `rawResultCount`; `useOmniboxSearch` performs the one filter. The `?minScore=` URL
  param is removed.

**Affected:** `frontend/src/hooks/use-search-thresholds.ts` (new),
`frontend/src/components/search/filter-chip.tsx`,
`frontend/src/hooks/use-omnibox-search.ts`,
`frontend/src/hooks/use-url-search.ts`,
`frontend/src/components/omnibox/omnibox.tsx` (pass threshold props through).

### 6. Image upload → global or region

- In `RegionSupportDialog`, the **Done** button is enabled with zero points. Its
  label adapts: `Global search` (0 points) ↔ `Region search` (≥1 point). The
  "Clear" button stays disabled at zero points.
- `useOmniboxSearch.submitSupportRegion(points, chosenFilePath)` handles the
  zero-point case:
  - `support.kind === "upload"` → `url.submitImage(file)` (global image search);
  - `support.kind === "frame"` → `url.submitSimilar(effectiveFilePath)` (global
    similar search on the chosen frame);
  - both set modality `visual` and clear the region searcher.
  - `points.length > 0` keeps today's region path.
- The Enter-key path in `submit()` is routed through the same logic so behavior is
  consistent whether the user clicks Done or presses Enter.
- The support chip still re-opens the dialog (`onEdit`) to add/edit points after a
  global search.

**Affected:** `frontend/src/components/search/region-support-dialog.tsx`,
`frontend/src/hooks/use-omnibox-search.ts`.

### 7. Backend — persist & expose the indexing error reason

- `src/api/state.py`: add `indexing_errors = PersistentStatusStore(ERRORS_PATH)`
  (a new state file alongside `STATE_PATH`), reusing the existing thread-safe store.
- `src/services/indexing_service.py`: `IndexingService` takes an optional
  `error_store`. In `index_bag`, clear the bag's error on start; on success clear it
  again; in the `except` branch, store a concise `str(exc)`.
- `src/api/dependencies.py`: pass `indexing_errors` into `get_indexing_service`.
- `src/api/bags.py`: `/scan` and `/status` include
  `error_message = indexing_errors.get(bag_path)`.
- Frontend `BagInfo.error_message` and the polling merge in `use-bags.ts` already
  exist; they simply start receiving values.

**Affected:** `src/api/state.py`, `src/utils/paths.py` (new `ERRORS_PATH`),
`src/services/indexing_service.py`, `src/api/dependencies.py`, `src/api/bags.py`.

## Out of scope

- Preserving shareable `?bags=` / `?minScore=` deep links.
- Backend-side score thresholding (filtering stays client-side).
- Any change to ingestion, embeddings, or the region-search engine.
- The pre-existing unauthenticated `/api/image` gap (tracked separately).

## Testing

- **Backend (pytest):** `/scan` and `/status` return `error_message`; a failed
  index records a message that a subsequent reset clears. Run with
  `PYTHONPATH="" uv run pytest tests/`.
- **Frontend:** `cd frontend && npm run lint` and `npm run build` must pass.
- **Manual:** grouped/nested tree renders for the real `bags/` layout
  (`2025-10-23_15-42` top-level vs `2026-05-19/*` nested); visibility toggle hides a
  bag's track and excludes it from search; rail clears the sidebar and zoom
  controls; uploading an image and pressing Done with no points runs a global
  search; text vs visual thresholds apply their respective defaults.
