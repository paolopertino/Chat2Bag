# Phase 3: `/search` Page + Per-Bag Search — Design Spec

**Date:** 2026-04-28
**Scope:** Carve the semantic search experience out of `WorkspacePage` into a dedicated `/search` route, and add per-bag search to the existing Phase 2 `BagDetailPage` via a timeline pin overlay. Pure frontend refactor. No backend changes.
**Constraint:** `/workspace` must remain fully functional until Phase 4. Phase 3 is **copy-and-adapt**, not move.

---

## 1. Overview

Today, all search UX lives inside `WorkspacePage` (`/workspace`): the search bar sits at the top, results appear as a grid, and clicking a result opens a fullscreen modal sequence viewer. Phase 3 introduces:

- A dedicated `SearchPage` at `/search` for cross-bag semantic search. Search state is fully URL-encoded so results are shareable, refresh-safe, and survive browser back/forward.
- A new pin-overlay capability on the Phase 2 `BagDetailPage` (`/bags/:bagId`) that lets users search a single bag and visualize hits as colored markers on a proportional timeline rail above the existing thumbnail strip.
- An extensible `Pin` data model so future sources (fault-log CSVs, manual annotations, sample windows) can drop pins on the same rail without changing call sites.

Clicking a search result on `/search` navigates to `/bags/:bagId?t=<ns>` (the canonical Phase 2 viewer). The legacy modal sequence viewer is retained only on `/workspace` and is deleted by Phase 4 along with the rest of `WorkspacePage`.

---

## 2. Route Tree & URL Contract

Delta from Phase 2:

```
/search                                  SearchPage             (replaces Phase 1's /search → /workspace redirect)
/bags/:bagId                             BagDetailPage          (Phase 2; gains per-bag search)
```

### 2.1 `/search` URL contract

URL is the single source of truth for search state.

| Param | Required | Type | Default | Notes |
|---|---|---|---|---|
| `q` | no | string | none | Text query. Mutually exclusive with `similar`. |
| `bags` | no | comma-separated bag IDs | all indexed | Phase 2's base64url id scheme; unknown ids are silently dropped with a toast. |
| `topK` | no | int (clamped 1..100) | `10` | Server-side. Passed as `top_k` to the API. |
| `minScore` | no | float (clamped 0..1) | `0` | Client-side filter on the response array. |
| `similar` | no | string (file path) | none | Image-similarity source. Mutually exclusive with `q`. |

Image-upload search has no URL representation (file is a blob). Submitting it triggers an in-page POST to `/api/search/image` that updates `useSearch` state without changing the URL. Bookmark/share will not include the uploaded image — accepted limitation.

### 2.2 `/bags/:bagId` URL contract (extended)

Phase 2 already defines `?t=<ns>`. Phase 3 adds three params:

| Param | New? | Notes |
|---|---|---|
| `t` | existing | Timestamp ns to jump the viewer to. |
| `q` | **new** | Text query for per-bag search. Activates pin overlay. |
| `similar` | **new** | Image-similarity source path. Backend filters to current bag. |
| `minScore` | **new** | Client-side score threshold for the pin overlay. |

Per-bag search shares the search-param shape of `/search` minus `bags=` — the bag is implied by the route.

### 2.3 Removed routes

- Phase 1 redirect `/search → /workspace` is removed and replaced by the real `SearchPage`.

### 2.4 Bag ID helpers

Reuses existing `frontend/src/lib/bag-id.ts` from Phase 2 (`encodeBagId` / `decodeBagId`). No changes.

---

## 3. `SearchPage` (`/search`)

### 3.1 Layout

No sidebar (full-width main area). The page does not call `useSidebar`, so `MainLayout`'s sidebar slot stays empty.

```
┌── Top bar (existing) ──────────────────────────────────────────────────────┐
│  app name | Jobs ▾ | user                                                  │
├── Header row (sticky inside main area) ────────────────────────────────────┤
│  [🔍  text query …                          ] [📷] [📂 3 bags ▾] [Search]   │
├── Filter summary chip ─────────────────────────────────────────────────────┤
│  K=10 · ≥0.30 · ⚙ Adjust              142 hits · 3 bags                    │
├── Results grid ────────────────────────────────────────────────────────────┤
│  ┌──┐┌──┐┌──┐┌──┐                                                          │
│  │  ││  ││  ││  │                                                          │
│  └──┘└──┘└──┘└──┘                                                          │
└────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Header row

Order, left-to-right:

1. **Text input** — placeholder "Search across N indexed bags". Submitting (Enter or Search button) writes `?q=` to URL.
2. **📷 image-upload button** — opens file picker. On selection, `useSearch.runImageSearch(file, scopedBags)` fires immediately. Does not update URL (image is transient).
3. **📂 BagPickerChip** — closed state shows count "📂 3 bags ▾". Clicking opens a popover (see §3.3).
4. **Search button** — submits the current text input. Hidden during image-upload (no separate submit needed for images).

### 3.3 BagPickerChip popover

| Region | Behavior |
|---|---|
| Header | "Search in" label + "<n> / <total> selected" counter. |
| Filter input | Free-text filter by bag name (client-side substring match). |
| Quick actions | "Select all indexed" · "Clear". |
| List | Each row: checkbox · bag name · indexing-state badge (`done` / `indexing` / `idle` / `error`). Un-indexed bags rendered greyed-out and not selectable. |
| Footer | Link to `/bags` ("Manage bags & scan more"). |
| Default selection | All indexed bags on first visit. After that, URL controls. |
| Persistence | Selection writes back to URL as `?bags=<ids>` immediately on toggle. Popover closes on outside click; selection is committed on every toggle (no separate "Apply" step). |

### 3.4 FilterChip

Compact summary chip below the header row. Two states:

- **Collapsed** (default): one-line summary "K=10 · ≥0.30 · ⚙ Adjust" on the left, "<n> hits · <m> bags" status on the right.
- **Expanded** (after clicking ⚙ Adjust): the chip grows in place into a row with two sliders (`Top K` 1–100 default 10; `Min similarity` 0.0–1.0 default 0). Outside-click collapses.

Slider drags fire on `onChange`:
- `topK` change → re-fetches via `useSearch.runSearch` (server-side parameter).
- `minScore` change → client-side `results.filter(r => r.similarity_score >= minScore)`. No refetch.

Both also write to the URL (`?topK=`, `?minScore=`).

Future filters (modality, date, topic) chain into the same chip without architectural changes.

### 3.5 Results grid

Reuses existing `ResultsGrid` + `ImageCard` components. Click handlers replaced:

- **Card click** → `useNavigate('/bags/:bagId?t=<timestamp_ns>')`. The `<a>` underlying React Router supports Cmd/Ctrl-click → new tab.
- **Magnifier click** (similar search) → `setSearchParams({ similar: result.file_path, q: undefined })`. The URL change triggers a refetch via the `searchSimilar` API. No navigation.

### 3.6 Empty / loading / zero-result states

| State | Trigger | UI |
|---|---|---|
| **Empty** | No `q` and no `similar` in URL | Centered message in main area: "Search across N indexed bags". Below it: 3–4 example chips ("pedestrian", "parked car", "traffic light"). Clicking an example sets `?q=` and submits. |
| **Loading** | Pending search request | Existing skeleton card grid. |
| **Zero results above threshold** | `results.length` raw > 0 but `results.filter(minScore).length === 0` | "No matches above threshold" message + "Lower the threshold" link to expand the FilterChip. |
| **Zero results from backend** | `results.length === 0` | "No matches found." Plain message. |
| **No bags indexed** | `bags.filter(is_indexed).length === 0` | "No indexed bags yet." CTA button → `/bags`. Search input disabled. |
| **Backend error** | `useSearch` throws | Existing toast pattern. URL preserved so refresh retries. |

---

## 4. `BagDetailPage` Modifications (`/bags/:bagId`)

### 4.1 Page header replacement

Today's bag-name + status header is replaced with a search-aware header:

```
2025-01-15_10-30 · ●done    [🔍 Find in this bag …]    [📷] [⚙]
```

- Bag name + status badge: left-aligned compact label (no longer the visual centerpiece).
- **Search input**: same `SearchInput` component as `/search`. Submitting writes `?q=` to URL.
- **📷 image-upload**: scoped to current bag. Backend filter `bag_paths=[currentBag]`.
- **⚙ FilterChip**: same component as `/search` (only `minScore` is meaningful per-bag; `topK` defaults to a higher value, e.g. 100, since we want all hits inside a single bag).
- Esc clears `?q=` / `?similar=` and dismisses pins; `?t=` is preserved so the viewer stays put.

### 4.2 Two-component timeline

Above the existing thumbnail strip, a new `PinRail` component renders a proportional minimap of the entire bag with pin markers:

```
┌── PinRail (NEW) ──────────────────────────────────────────────┐
│  ╎  ╎  ╎ ●  ╎  ●  ╎      ╎●         ╎  ╎ ●        ╎  ╎  ╎ ●  │   ← bag-wide pins
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │   ← orange viewport band
└────────────────────────────────────────────────────────────────┘
┌── ThumbnailStrip (existing, +highlightedTimestamps prop) ─────┐
│  ▭  ▭  ▭  ▭  ▭  ▭  ▭  ▭  ▭  ▭  ▭  ▭  ▭  ▭  ▭  ▭  ▭  ▭         │
└────────────────────────────────────────────────────────────────┘
```

- **PinRail** maps timestamps to pixel x-positions linearly across the full bag time range. Pin color/intensity encodes score (search hits) or category (future sources via `pin.color` override).
- **Viewport band**: the orange overlay shows which slice of the bag's time range the thumbnail strip is currently displaying. It updates as the strip scrolls.
- **Click a pin** → `setSelectedTimestampNs(pin.timestamp_ns)`. The strip auto-scrolls to that frame (existing behavior). Pin remains visually emphasized.
- **Up / Down arrow keys** → cycle to next / previous pin (sorted by `timestamp_ns`). Existing Left / Right keys still step frame-by-frame.
- **ThumbnailStrip** receives a new prop `highlightedTimestamps: Map<number, number>` (timestamp_ns → score). Matching frames render with an orange outline and a small score badge in the corner. Strip's existing pagination, scroll, and selection logic are unchanged.

### 4.3 Pin overlay state machine

| Trigger | Effect |
|---|---|
| `?q=` becomes non-empty | `usePins` runs the query against current bag; pins update. |
| `?similar=` becomes non-empty | Same, via `searchSimilar`. |
| `?minScore=` changes | Pins are filtered client-side; rail updates without refetch. |
| Search cleared | Pins drop to `[]`; rail empty; strip highlight clears. |
| Pin clicked | Viewer jumps to that frame; pin stays emphasized. |
| Up / Down key | Selects next pin in sorted order; viewer jumps. |
| Bag time range unknown (frames not yet loaded) | Rail renders skeleton until first frames arrive. |

### 4.4 Bag root chip + tree (Phase 2 sidebar) — unchanged

The existing Phase 2 sidebar (root chip + compact tree) is unaffected. Per-bag search lives entirely in the main area's page header.

---

## 5. Shared Components

| Component | Type | Used by | Notes |
|---|---|---|---|
| `SearchInput` | new | `SearchPage`, `BagDetailPage` | Wraps text input + ✕ clear button (visible when value is non-empty) + 📷 upload + Enter-to-submit. Accepts `placeholder`, `value`, `onChange`, `onSubmit(text)`, `onClear`, `onImageUpload(file)`, `disabled`. Stateless about URL — the parent threads URL state in/out. |
| `BagPickerChip` | new | `SearchPage` | Closed chip + popover. Reads `BagsProvider` for the list. |
| `FilterChip` | new | `SearchPage`, `BagDetailPage` | Collapsed summary + expanded slider row. Accepts `topK`, `minScore`, `onChange`, `showTopK?` (false on per-bag). |
| `PinRail` | new | `BagDetailPage` | Proportional time-axis rail with pins + viewport band. Accepts `pins`, `timeRange`, `viewportRange`, `selectedTimestampNs`, `onPinClick`. |
| `ResultsGrid` + `ImageCard` | existing | `SearchPage` | Reused as-is. Click handlers re-wired. |
| `ThumbnailStrip` | existing, +1 prop | `BagDetailPage` | Adds `highlightedTimestamps?: Map<number, number>`. |
| `BagSequenceViewer` | existing, light edit | `BagDetailPage` | Adds the `PinRail` above its `ThumbnailStrip`, and the search-aware page header. |

The legacy `SearchBar` component stays on disk for `/workspace` only. **It is not reused on `/search`** — `SearchPage` composes `SearchInput` + `BagPickerChip` + `FilterChip` directly.

---

## 6. Pin Model

Generic from day one — Phase 3 only registers a search-results provider, but the API is shaped for future sources.

```ts
// frontend/src/types/pin.ts
export interface Pin {
  timestamp_ns: number;
  source: string;            // "search" | "fault_log" | "annotation" | …
  score?: number;            // 0..1; drives default color intensity
  label?: string;            // hover tooltip
  color?: string;            // optional per-pin color override
}

export interface PinProvider {
  source: string;
  getPins(bagPath: string): Pin[] | Promise<Pin[]>;
}
```

`usePins(bagPath, results, minScore, additionalProviders?)`:
- Synthesizes search-result pins internally: each `SearchResult` whose `bag_path` matches `bagPath` becomes a pin with `source: "search"`, `score: result.similarity_score`.
- Filters pins by `score >= minScore`.
- If `additionalProviders` provided (Phase 5+), awaits each provider's `getPins(bagPath)` and merges into the same flat array.
- Returns `Pin[]` sorted by `timestamp_ns`.

Phase 3 deliverable: the `Pin` type, `PinProvider` interface, and `usePins` hook with the search provider only. No additional providers built. No persistence. Phase 5+ can add providers without touching `BagDetailPage` call sites.

---

## 7. State Ownership

Three shared-state boundaries; everything else is local to its page.

### 7.1 Bag-list state — `BagsProvider` (lifted from Phase 2)

- New component mounted inside `ProtectedRoute` (above `MainLayout`), mirroring Phase 2's `JobsProvider` pattern.
- Wraps the existing `useBags` hook and publishes its return value via React context (`BagsContext`).
- The existing `useBags` hook is **renamed to `useBagsState`** and called once inside `BagsProvider`. A new `useBags()` consumer hook reads the context and returns the same shape as the old hook. All current call sites continue to work without signature changes.
- Phase 2's `BagsLayout` switches from owning the hook directly to reading it from context. Outlet context shape is preserved (existing Phase 2 children unaffected).
- New consumer: `SearchPage`'s `BagPickerChip` reads the bag list from context. No re-scan.
- Polling, root-dir persistence, scan-on-submit semantics — all unchanged.

### 7.2 Search state — `useUrlSearch(scope?)` *new*

- Reads `q`, `topK`, `bags`, `similar`, `minScore` from `useSearchParams`.
- Internally wraps existing `useSearch` (no changes to that hook).
- Triggers `runSearch` / `runImageSearch` / `runSimilarSearch` when relevant URL params change.
- Returns `{ query, topK, bags, similar, minScore, results, isSearching, setSearchState(partial), submitText(text), submitImage(file) }`.
- `scope?.bags` overrides the URL `bags` param (used by `BagDetailPage` to force single-bag scope).
- URL writes are batched via `setSearchParams` to avoid double history entries.

### 7.3 Pin state — `usePins(bagPath, results, minScore, providers?)` *new*

- Pure derivation hook. No internal state beyond memoization.
- Recomputes on changes to `results`, `minScore`, or `providers`.

### 7.4 Component-local state

- `BagPickerChip`: popover open/closed.
- `FilterChip`: expanded/collapsed.
- `SearchInput`: in-progress text typing (committed to URL on Enter / Submit).
- `BagDetailPage`: Phase 2's existing local state (frames, selected timestamp, chat).

**Not lifted:** image-search transient state (the uploaded `File`), chat panel state, dialog form state.

---

## 8. Legacy `/workspace` Impact

Minimum-diff adjustments — `WorkspacePage` itself does not change behavior visibly. The complete touched-files inventory (including new feature code) lives in §10; this section lists only the changes made *for the workspace fallback to keep working*.

| File | Change |
|---|---|
| `frontend/src/router.tsx` | Remove `/search → /workspace` redirect. Add `{ path: "search", element: <SearchPage /> }`. |
| `frontend/src/components/layout/protected-route.tsx` | Mount `<BagsProvider>` around `<Outlet />`, alongside the existing `<JobsProvider>`. |
| `frontend/src/pages/bags/bags-layout.tsx` | Replace direct `useBags()` call with `useBagsContext()` read. Outlet context shape preserved. |
| `frontend/src/pages/workspace.tsx` | Replace direct `useBags()` call with `useBagsContext()`. **No other change.** Sidebar still owns its scanner + bag list + jobs panel. Modal sequence viewer still opens on result click. |
| `frontend/src/pages/dashboard.tsx` | Flip Search card from `coming-soon` to `available`. |

Components retained for `/workspace` only (deleted in Phase 4):
- `SearchBar` (legacy, with embedded bag count + topK input)
- `SequenceViewer` (modal variant)
- `BagList` (legacy multi-select with checkboxes — already used by `/workspace` sidebar)

---

## 9. Error & Edge States

### 9.1 `/search`

| Scenario | Behavior |
|---|---|
| No bags indexed yet | Empty state in main area: "No indexed bags yet · Go to Bag Explorer" CTA → `/bags`. Search input disabled. |
| All scanned bags un-indexed | Search input enabled but submit shows toast: "Index at least one bag to search." Picker shows them greyed out. |
| `?bags=<unknown_id>` from a stale URL | Unknown ids dropped silently from selection. Toast: "<N> bag(s) from your URL are no longer available." Search proceeds with the rest. |
| `?topK` / `?minScore` out of range | Clamped client-side (`topK ∈ [1, 100]`, `minScore ∈ [0, 1]`). URL is normalized via `setSearchParams`. |
| `?similar=<path>` to a missing file | Backend returns 404 → existing toast pattern. URL stays so the user can fix the path or reset. |
| Empty submission (no `q`, no `similar`) | No backend call. Empty state with examples. Submit on empty input is a no-op. |
| Backend error | `useSearch` toasts; URL preserved so refresh retries. |
| Result clicked, bag de-indexed mid-session | Navigate to `/bags/:bagId`; Phase 2 detail page handles its own un-indexed empty state. |
| Browser back from `/bags/:bagId` | URL state restores instantly. `useSearch` cache returns the prior results without a refetch when URL hasn't changed. |
| Two browser tabs open | Each has its own `BagsProvider` and `JobsProvider`. Harmless duplicate polling. |

### 9.2 Per-bag search on `/bags/:bagId`

| Scenario | Behavior |
|---|---|
| `?q=` typed but bag not indexed | Search input disabled; tooltip "Index this bag to enable search." Honors Phase 2's empty state. |
| Pin clicked, frame not in loaded strip range | Strip's existing pagination triggers; once the frame is loaded, the strip auto-scrolls and selects it. Loading shimmer in the meantime. |
| All hits below threshold | PinRail empty; message "0 visible / N hits below threshold · Lower the threshold". |
| Search cleared (✕ click or Esc) | `?q=` / `?similar=` removed from URL. Pins clear. Strip returns to default state. `?t=` preserved. |
| Bag has no extracted frames | Search returns zero hits. Same "0 hits" empty state. |
| `?similar=<path>` to a frame in a different bag | Backend filter `bag_paths=[currentBag]` ensures only same-bag matches return. |
| Bag length not yet known when search arrives | PinRail renders a skeleton until the first frames load and the time range is determinable. |

---

## 10. File / Component Inventory

### New files

```
frontend/src/
├── types/
│   └── pin.ts                                        # Pin, PinProvider
├── context/
│   └── bags-context.tsx                              # BagsProvider + useBagsContext()
├── hooks/
│   ├── use-url-search.ts                             # useUrlSearch(scope?)
│   └── use-pins.ts                                   # usePins(bagPath, results, minScore, providers?)
├── pages/
│   └── search.tsx                                    # SearchPage
└── components/
    ├── search/
    │   ├── search-input.tsx                          # text input + 📷 + Enter
    │   ├── bag-picker-chip.tsx                       # closed chip + popover
    │   └── filter-chip.tsx                           # summary + expanded sliders
    └── bags/
        └── pin-rail.tsx                              # proportional time-axis rail with pins + viewport band
```

### Touched files (minimum-diff)

- `frontend/src/router.tsx` — replace `/search` redirect with `<SearchPage />`.
- `frontend/src/components/layout/protected-route.tsx` — mount `<BagsProvider>` alongside `<JobsProvider>`.
- `frontend/src/pages/bags/bags-layout.tsx` — read `useBags` from context instead of owning the hook.
- `frontend/src/pages/workspace.tsx` — read `useBags` from context. No visual change.
- `frontend/src/pages/bags/bag-detail-page.tsx` — add per-bag search header, render `<PinRail>` above `<ThumbnailStrip>`, wire `usePins` + `useUrlSearch({ scope: { bags: [currentBag] } })`.
- `frontend/src/components/bags/bag-sequence-viewer.tsx` — accept `pinRail` and `highlightedTimestamps` props; render the rail above the strip.
- `frontend/src/components/bags/thumbnail-strip.tsx` (or equivalent in `bag-sequence-viewer.tsx`) — accept and apply `highlightedTimestamps`.
- `frontend/src/pages/dashboard.tsx` — flip Search card from `coming-soon` to `available`.

### Untouched

- All `src/api/*.py` (backend).
- All `src/auth/*.py`.
- `useSearch` hook (wrapped, not modified).
- Legacy `SearchBar`, `SequenceViewer` (modal), `BagList` components — retained for `/workspace`.
- `JobsProvider`, `JobsDropdown`, extraction-related components.

---

## 11. Testing

| Layer | What |
|---|---|
| Backend | **No new tests.** No backend changes. Existing `tests/test_api_contracts.py` continues to cover `/api/search`, `/api/search/image`, `/api/search/similar`. |
| Frontend automation | **No new infrastructure.** Vitest is not introduced (consistent with Phase 2). TypeScript + ESLint + manual QA are the safety net. |
| Regression | Existing `pytest tests/` and `npm run lint` must stay green. |

**Manual QA checklist** (lands in the implementation plan):

- `/search` empty state shows with 0 query and bag count.
- Search submit writes `?q=` to URL; refresh restores results.
- Filter chip expand/collapse; topK slider triggers refetch; minScore slider re-filters live without refetch; both write to URL.
- BagPicker popover: filter input, select-all/clear, individual toggles all write to URL.
- Image upload search runs without URL change.
- Similar search via magnifier replaces `?q=` with `?similar=`.
- Click a result → navigates to `/bags/:bagId?t=<ns>`. Cmd/Ctrl-click opens new tab.
- Browser back from detail page → restores results instantly.
- `?bags=<bad_id>` produces a toast and proceeds with valid ids.
- Clamping: `?topK=999` and `?minScore=2` are normalized.
- "No indexed bags" CTA links to `/bags`.
- Per-bag search: typing in the bag detail header writes `?q=`, pins appear on the rail, matching thumbnails get highlighted.
- Pin click jumps the viewer; Up/Down keys cycle pins; Esc clears search and preserves `?t=`.
- Scrolling the thumbnail strip moves the orange viewport band on the rail.
- Search active on an un-indexed bag → input disabled with tooltip.
- minScore threshold filtering hides pins live.
- `/workspace` continues to work: scanner + bag list + checkbox-scoped search + modal sequence viewer + extract dialog + sidebar Jobs tab.
- Dashboard Search card now navigates to `/search`.

---

## 12. Out of Scope

- Recent-searches history (localStorage).
- Modality / date / topic filters (foundation laid by `FilterChip`; no values added yet).
- Annotation pins, fault-log pins, sample-window pins (foundation laid by `Pin` + `PinProvider` + `usePins(..., providers?)`; no providers built in Phase 3).
- Saved searches (server-side).
- Multi-bag pin merging on `/bags/:bagId` (the bag detail viewer is single-bag by design).
- Vitest / frontend unit-test harness.
- Removing legacy `SearchBar` / `SequenceViewer` / `BagList` (happens in Phase 4 along with `/workspace` deletion).
- Backend changes to `/api/search/*`.
- A "search anywhere" global keyboard shortcut.
