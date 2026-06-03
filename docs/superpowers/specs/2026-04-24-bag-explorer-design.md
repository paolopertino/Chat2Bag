# Phase 2: `/bags` Bag Explorer — Design Spec

**Date:** 2026-04-24
**Scope:** Carve bag scanning, bag browsing, and per-bag frame inspection out of `WorkspacePage` into a dedicated `/bags` route. Pure frontend refactor. No backend changes.
**Constraint:** `/workspace` must remain fully functional until Phase 4. Phase 2 is **copy-and-adapt**, not move.

---

## 1. Overview

Today, all bag-related UX lives inside `WorkspacePage` (`/workspace`): the bag scanner and bag list sit in the sidebar; the sequence viewer opens as a modal-like overlay from a search result. Phase 2 introduces a dedicated Bag Explorer at `/bags` where:

- Users pick a root directory and see a folder tree of bag directories discovered by the scan.
- Selecting a bag navigates to a detail page with a full-page sequence viewer (frame canvas, thumbnail strip, VLM chat panel, extract-dataset action).
- Extraction jobs surface globally via a new top-bar dropdown instead of a sidebar tab.

The existing `WorkspacePage` is left intact so search (Phase 3) and dataset (Phase 4) work can continue to use it as a reference / fallback.

---

## 2. Route Tree

Delta from Phase 1:

```
/bags                              BagsLayout               (layout route, owns useBags + renders <Outlet/>)
  index                            BagsListPage             (full-width path input + folder tree)
  :bagId                           BagDetailPage            (sidebar = tree + root chip; main = sequence viewer)
```

- `:bagId` is `base64url(bag_path)`. Opaque in the URL; decoded client-side to call the existing `/api/bags/*` endpoints that accept `bag_path` as a query param.
- Optional `?t=<ns>` query param on `/bags/:bagId` jumps the viewer to that timestamp on mount. Absent → open at the bag's first frame. Reserves the integration point for Phase 3 `/search` without building it now.
- The existing `/bags/*` catch-all stub in `router.tsx` is replaced by these two real routes.
- `/workspace`, `/search → /workspace` redirect, `/datasets/*` stub, `/login`, and `/` (Dashboard) are unchanged.

**Bag ID helpers** — `frontend/src/lib/bag-id.ts`:

```ts
export function encodeBagId(bagPath: string): string;   // base64url encode
export function decodeBagId(bagId: string): string;     // base64url decode; throws on malformed input
```

---

## 3. Top-Bar Jobs Dropdown

Extraction jobs are global state (not per-page, not per-bag). They move out of the `/workspace` sidebar's Jobs tab into a top-bar dropdown available on every protected page.

- New component `components/layout/jobs-dropdown.tsx`, rendered inside `components/layout/top-bar.tsx` between the app name and the user badge.
- Button label: `Jobs` with a small count pill `Jobs · 2` when any job is in `queued` or `running`. Plain `Jobs` otherwise.
- Click opens a popover (`components/ui/dropdown-menu.tsx` or `popover`) whose body is the existing `JobsPanel` component reused verbatim.
- Empty state inside the popover: "No extraction jobs yet."
- Hidden entirely when `extractionEnabled === false` (consistent with today's `Sidebar` behavior).

The legacy `/workspace` sidebar Jobs tab stays — it simply reads from the same shared state (see §6) so both surfaces agree.

---

## 4. `BagsListPage` (`/bags` index)

Two visual states driven by one rule — `bags.length === 0` → hero; otherwise → top-strip.

**Hero state** (no bags loaded yet):
- Root-dir input rendered centered vertically *and* horizontally in the main area, visually prominent ("search-bar"-style: large width, clear affordance).
- Label, input, Scan button. Pressing Enter in the input also triggers scan.
- Last-used root persists in `localStorage` (existing behavior of `useBags`); pre-fills the input on mount but does NOT auto-scan.
- If the most recent scan returned zero bags, stay in hero and render "No bags found in this directory" directly under the input.

**Top-strip state** (bags loaded, `bags.length > 0`):
- Root-dir input animates (Tailwind `transition-all`) to a compact full-width strip at the top of the main area. Same control set (input + Scan).
- Below the strip, the `BagTree` fills the remainder of the main area.
- Scanning again updates the tree in place; empty result → revert to hero.

**`BagTree` component** (`components/bags/bag-tree.tsx`):
- Inputs: `{ bags, selectedBagPath, onSelectBag, onIndex }`. No multi-select / no checkboxes (unlike the legacy `BagList`).
- Derives folder grouping from `bag_path` values on the frontend (backend already returns absolute paths). Auto-collapses chains of single-child folders so `/data/project-x/day1/bag_001` renders as `project-x/day1/bag_001` under the root when each intermediate folder has only one child.
- Leaves render: bag name, status badge (reuses today's color semantics: `idle` / `indexing` / `done` / `error`), and an `Index` or `Re-index` button (disabled while indexing, with spinner).
- Clicking a leaf navigates to `/bags/:bagId` via React Router `<Link>` (so Cmd/Ctrl-click opens in a new tab).
- Folder rows expand/collapse with chevron indicators. Root folder starts expanded; deeper folders start expanded on list page (user just ran a scan, they want to see everything) and collapsed-except-for-selected-path on detail page.
- Empty state: when rendered with `bags.length === 0` (e.g., in the detail-page sidebar after a direct URL load with no prior scan), the tree shows the hint "Scan a root directory to list bags." The `BagRootChip` above the tree remains the primary affordance.

**Sidebar on list page:** nothing injected. The tree lives in the main area until a bag is selected.

---

## 5. `BagDetailPage` (`/bags/:bagId`)

### 5.1 Mount behavior

1. Read `:bagId` from `useParams()`; decode to `bag_path` via `decodeBagId`.
2. Invalid / malformed id → render a "Bag not found" card with a link back to `/bags`. No crash.
3. If `bagsState.bags` (from outlet context) already contains this path → use it directly.
4. Otherwise call `GET /api/bags/status?bag_path=<path>` to reconstruct `{ status, is_indexed }`. 404 → "Bag not found at `<path>`" card.
5. If `!is_indexed` → hide the sequence viewer; render an inline empty state: "This bag isn't indexed yet." + an Index button that calls the same indexing endpoint as the tree. The detail page must ensure the current bag is included in `useBags` polling so status transitions to `done` automatically. If the bag is already in `bagsState.bags` (populated by a prior scan) this is free. Otherwise the detail page registers the bag with `BagsLayout` — `useBags` exposes a `registerBag({ bag_path, bag_name, is_indexed, status })` action that merges a synthetic entry into `bags[]` so the existing polling loop covers it. Entry is removed on unmount. No separate polling loop.
6. Otherwise → render `BagSequenceViewer` with initial timestamp = `?t=<ns>` if present, else the bag's first frame.

### 5.2 Sidebar slot

Injected via `useSidebar()`. Contents top-to-bottom:

1. **`BagRootChip`** (`components/bags/bag-root-chip.tsx`) — collapsed representation of the root input. Shows the current root dir (truncated with tooltip on hover). A "change root" icon button expands it inline into the full input + Scan button (same control as the list page's top strip, just in the sidebar). Re-scanning from here works exactly like on the list page.
2. **`BagTree`** — same component as the list page, rendered in compact mode. Current bag is highlighted. Clicking another leaf navigates to that bag (`/bags/:bagId`). Because state lives in `BagsLayout`, the tree is ready instantly — no refetch.

### 5.3 Main area layout

`BagSequenceViewer` (`components/bags/bag-sequence-viewer.tsx`) is a page-native variant of today's modal `SequenceViewer`. Same logic, different chrome:

- **Frame canvas** — center-top; large image of the selected frame (reuses `AuthImage`).
- **Thumbnail strip** — bottom; horizontally scrollable, previous/next buttons, load-more-left / load-more-right, VLM-window highlight band. Same behavior as today.
- **Chat panel** — right side, collapsible (toggle in the header). Query textarea, duration input, Ask button, response area. Uses existing `POST /api/chat` contract.
- **Action bar** — top-right of the viewer: `Extract dataset` button (opens `ExtractDatasetDialog`), `Re-index` button, frame-timestamp readout, close-style back button that navigates to `/bags`.
- Keyboard navigation (left/right arrow → prev/next frame) preserved.

The internal sub-components (`frame-canvas.tsx`, `thumbnail-strip.tsx`, `chat-panel.tsx`) can be extracted out of today's `sequence-viewer.tsx` into their own files and shared between the legacy modal and the new page-native viewer — but this extraction is optional; a straightforward copy-and-adapt that duplicates layout JSX is also acceptable and strictly within the "copy, don't move" constraint. The implementation plan will decide based on cost; either approach satisfies this spec.

### 5.4 Extract dataset

- `BagDetailPage` reuses the existing `ExtractDatasetDialog` component from `components/extraction/` — the same file `WorkspacePage` already imports. No duplication.
- Opens from the viewer's action bar. Prefills `bagPath` with the current bag, `centerNs` with the selected timestamp, and `defaultWindowS` with the current chat-duration setting (matches today's `handleExtractDataset`).
- On submit, the launcher calls `POST /api/datasets/extract`, then invokes `refresh()` on the shared jobs context so the top-bar dropdown and the legacy `/workspace` Jobs tab both reflect the new job.

---

## 6. State Ownership

Three shared-state boundaries; everything else is local.

### 6.1 Bag-list state — `BagsLayout`

- Owns `useBags()` (rootDir, bags, selectedBagPaths [unused in Phase 2 but retained for backwards compat with `/workspace`], scanning/polling flags, `onScan`, `onIndex`, etc.).
- Exposes it to children via `<Outlet context={bagsState}>`; children read it with `useOutletContext<BagsState>()`.
- Survives list↔detail navigation — polling doesn't restart, tree selection is instant.

### 6.2 Extraction-jobs state — `JobsProvider`

- New component mounted inside `ProtectedRoute` (above `MainLayout`). Wraps today's `useExtractionJobs` hook and publishes its return value through a React context.
- `useJobs()` consumer hook reads the context.
- Consumers:
  - `JobsDropdown` in the top bar (read-only + cancel/log actions).
  - `BagDetailPage` extract launcher (submit via `useExtractionLauncher(schema, refresh)`; `refresh` comes from context).
  - `WorkspacePage` sidebar Jobs tab — switched from calling `useExtractionJobs()` directly to calling `useJobs()`. Behavior unchanged; just shares the polling loop.
- Guarantees a single polling loop per tab and a single source of truth.

### 6.3 Per-page local state — `BagDetailPage`

- `useSequenceViewer` (frames, selected timestamp, chat state) — adapted so `openViewer()` can accept either a `SearchResult` (legacy) or a `{ bag_path, timestamp_ns }` pair. The adaptation adds a new entry point, e.g., `openViewerForBag({ bag_path, start_ns })`, without breaking the existing search-result path. Legacy `openViewer(result)` keeps working for `/workspace`.
- `useExtractionLauncher` — unchanged; hooked up to the jobs context instead of a per-page hook instance.

**Not lifted:** viewer frames / chat state / dialog form. They're scoped to a single bag visit and should be thrown away on unmount.

---

## 7. Legacy `/workspace` Impact

Minimum-diff adjustments so jobs state is shared without breaking behavior:

- `WorkspacePage`: replace `useExtractionJobs()` direct call with `useJobs()` context read. No visual change.
- `components/layout/sidebar.tsx`: no change — it still receives `jobs` as a prop from `WorkspacePage`.
- All other `/workspace` components (`BagScanner`, `BagList`, `SequenceViewer`, `ExtractDatasetDialog`, `JobsPanel`) stay on disk, still imported and rendered by `WorkspacePage`. Phase 4 deletes `/workspace` plus these components together.

---

## 8. Error & Edge States

| Scenario | Behaviour |
|---|---|
| Direct load of `/bags/:bagId` (page refresh) with no prior scan | Detail page fetches `GET /api/bags/status`; sidebar tree shows a hint ("Scan a root directory to list bags") + link to `/bags` if `bagsState.bags` is empty. |
| Decoded bag path no longer exists on disk | 404 from status endpoint → "Bag not found at `<path>`" card + back link. |
| Bag exists but isn't indexed | Viewer hidden; inline "This bag isn't indexed yet" + Index button. Polling transitions state automatically. |
| `?t=<ns>` out of the bag's frame range | Load first frame; toast: "Requested timestamp is out of range; showing bag start." |
| `?t=<ns>` on an unindexed bag | Honored once indexing completes (stored in state until frames are available). If indexing never completes, fallback to first frame after the viewer mounts. |
| Invalid / malformed `:bagId` (bad base64) | "Bag not found" card + back link. No crash. |
| Two browser tabs open | Each tab has its own `JobsProvider` and its own `useBags()` state. Harmless duplication of polling. |
| Scan times out (30s, returns 504) | Existing toast handling; hero state retained. |
| User hits Extract on a bag whose status becomes `error` mid-dialog | Existing behavior — submit may still succeed; failure surfaces in the jobs dropdown. No new handling needed. |

---

## 9. File / Component Inventory

### New files

```
frontend/src/
├── lib/
│   └── bag-id.ts                               # encodeBagId / decodeBagId
├── context/
│   └── jobs-context.tsx                        # JobsProvider + useJobs()
├── pages/
│   └── bags/
│       ├── bags-layout.tsx                     # route layout, owns useBags
│       ├── bags-list-page.tsx                  # /bags index
│       └── bag-detail-page.tsx                 # /bags/:bagId
└── components/
    ├── bags/
    │   ├── bag-tree.tsx                        # folder-tree renderer
    │   ├── bag-root-input.tsx                  # hero + top-strip variants of the path input
    │   ├── bag-root-chip.tsx                   # collapsed chip for detail sidebar
    │   └── bag-sequence-viewer.tsx             # page-native viewer
    └── layout/
        └── jobs-dropdown.tsx                    # top-bar dropdown consuming useJobs()
```

(Sub-extraction of `frame-canvas`, `thumbnail-strip`, `chat-panel` out of today's `sequence-viewer.tsx` is optional; implementation plan decides.)

### Touched files (minimum-diff)

- `frontend/src/router.tsx` — replace `/bags/*` stub with `BagsLayout` + nested routes.
- `frontend/src/App.tsx` (or `main.tsx`) — wrap `<RouterProvider>` in `<JobsProvider>`, or mount inside `ProtectedRoute`.
- `frontend/src/components/layout/protected-route.tsx` — mount `<JobsProvider>` around `<Outlet>`.
- `frontend/src/components/layout/top-bar.tsx` — add `<JobsDropdown>`.
- `frontend/src/pages/workspace.tsx` — swap `useExtractionJobs` → `useJobs`.
- `frontend/src/hooks/use-sequence-viewer.ts` — add `openViewerForBag({ bag_path, start_ns })` entry point; existing `openViewer(result)` stays.
- `frontend/src/pages/dashboard.tsx` — flip Bag Explorer card from `coming-soon` to `available`.

### Untouched

- All `src/api/*.py` (backend).
- All `src/auth/*.py` and `scripts/manage_users.py`.
- Existing components: `BagScanner`, `BagList`, `SequenceViewer`, `ExtractDatasetDialog`, `JobsPanel`, `Sidebar`. (Still used by `/workspace`.)

---

## 10. Testing

- **No new backend tests.** No backend changes. Existing `tests/test_api.py` and `tests/test_api_contracts.py` continue to cover `/api/bags/*`.
- **No new frontend test infrastructure.** Vitest is not set up in this repo; Phase 2 does not introduce it. TypeScript + ESLint + manual QA are the safety net.
- **Manual QA checklist** (goes into the implementation plan):
  - Hero-state → top-strip transition on successful scan.
  - Zero-result scan stays in hero with empty-state message.
  - Tree collapses single-child chains correctly; expand/collapse state intact after re-scan.
  - Click bag → `/bags/:bagId`; Cmd/Ctrl-click opens new tab.
  - List↔detail navigation preserves polling; indexing progress visible from detail via shared tree.
  - Direct load of `/bags/:bagId` (URL paste / page refresh) reconstructs state from status endpoint.
  - `?t=<ns>` positions viewer; out-of-range toast works.
  - Index / Re-index buttons on tree leaves and on the unindexed-detail empty state both function.
  - Extract dialog prefills correctly; submit shows the new job in the top-bar dropdown.
  - Top-bar jobs dropdown badge updates when jobs transition.
  - `/workspace` still scans, indexes, searches, opens the modal sequence viewer, and the legacy sidebar Jobs tab lists the same jobs as the top-bar dropdown.
  - Dashboard card for Bag Explorer is clickable and lands on `/bags`.

---

## 11. Out of Scope

- Zoomable timeline overview for scrubbing long bags.
- Filtering the jobs dropdown by bag.
- Breadcrumbs in the top bar.
- Dataset Inspector UI (`/datasets`) — Phase 4.
- Search page refactor (`/search`) — Phase 3. The `/search → /workspace` redirect from Phase 1 stays.
- Bag deletion, un-indexing, renaming, tagging.
- Vitest / frontend unit test harness.
- Auto-scan on mount when a persisted root dir exists (deliberately manual — user hits Scan).
- Moving / deleting legacy `/workspace` code (happens in Phase 4).
