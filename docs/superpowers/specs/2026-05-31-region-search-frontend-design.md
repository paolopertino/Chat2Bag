# Region Search — Frontend (Slice 6) — Design Spec

**Date:** 2026-05-31
**Scope:** Build the front end for Region search (point/text-prompted dense-patch retrieval). MVP only — fold into the existing `/search` page as a Global ⇄ Region mode toggle, supporting all three query sources (text, uploaded image + points, promoted frame + points) plus an inspector lightbox with a heatmap overlay. Includes one small backend addition: point/frame heatmap endpoints.

**Source decisions (read first):**
- `docs/superpowers/specs/2026-05-30-region-search-design.md` — the backend spec. §9 (API table), §11 (error states), §14 (Slice 6 scope). This spec is its frontend counterpart.
- `src/api/search_routes.py` — the live request/response contracts the frontend types against.
- `CLAUDE.md` — frontend conventions (React 19 + Vite + Tailwind, React Router v6 shell, `useSidebar`, `http()` wrapper, `AuthImage`, kebab-case files / PascalCase components, ESLint / no Prettier).

**MVP framing.** The user will refactor the frontend soon, so this lands inside today's `/search` page structure without restructuring it. Polish and capability-probing features are explicitly deferred (§9).

---

## 1. Decisions (locked in brainstorming, 2026-05-31)

| # | Decision | Choice |
|---|---|---|
| 1 | Placement | Fold into `/search` as a **Global ⇄ Region** mode toggle (not a new route). |
| 2 | Query sources (v1) | **All three**: text, uploaded image + points, promoted frame + points. |
| 3 | Heatmap | **Add point/frame heatmap backend route now**; overlay works for every query type. |
| 4 | Input layout | **Inline toggle + modal canvas** — uploading/promoting opens a modal with a large point canvas, then collapses to a compact "support chip" beside the search bar. |
| 5 | Heatmap presentation | **Lightbox inspector** — card click opens a large frame with heatmap toggle + opacity slider + result stepping + "Open in Explorer" link. |
| 6 | State / URL | **Ephemeral results + sticky mode** — query payload never serializes to the URL; only `?mode=region` is sticky. Mirrors today's image-search behavior. |
| 7 | Promote entry | **Card action + lightbox button** — "Use as region support" available on each result card and inside the lightbox. |

Global search, Bag Explorer, ingestion, auth, and the existing results grid are unchanged.

---

## 2. Backend addition — point/frame heatmap

The existing heatmap endpoint is text-only. `RegionSearcher.heatmap_for_points(image, points, target_file_path)` already exists (`src/region/region_search.py:174`); it just needs service methods + routes. The heatmap dict shape is fixed by `RegionSearcher.heatmap` (`region_search.py:159`): `{"height": int, "width": int, "grid": list[list[float]]}` (H_p×W_p cosine floats).

### 2.1 `src/services/region_search_service.py`

```python
def heatmap_by_frame(self, support_file_path: str, points: list[dict], target_file_path: str) -> dict:
    if not support_file_path.strip():
        raise ValueError("support_file_path must not be empty.")
    if not target_file_path.strip():
        raise ValueError("target_file_path must not be empty.")
    image = Image.open(Path(support_file_path).expanduser().resolve()).convert("RGB")
    return self._searcher.heatmap_for_points(image=image, points=points, target_file_path=target_file_path)

def heatmap_by_image(self, image_bytes: bytes, points: list[dict], target_file_path: str) -> dict:
    if not image_bytes:
        raise ValueError("Image payload is empty.")
    if not target_file_path.strip():
        raise ValueError("target_file_path must not be empty.")
    image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    return self._searcher.heatmap_for_points(image=image, points=points, target_file_path=target_file_path)
```

### 2.2 `src/api/search_routes.py` (mirrors existing region routes + error handling)

| Endpoint | Body | Returns |
|---|---|---|
| `POST /api/search/region/heatmap/by-frame` | `{support_file_path, points:[{x,y}], target_file_path}` | `{height, width, grid}` |
| `POST /api/search/region/heatmap/by-image` | multipart: `image`, `points` (JSON string), `target_file_path` | `{height, width, grid}` |

Reuse `Point` for validation. `FileNotFoundError → 404`, `ValueError → 400`, `OSError → 400 "Invalid image file"`. When the active embedder lacks `dense`, `get_region_search_service` already raises 400 (per backend spec §9.2) — same as the search routes.

### 2.3 Tests (`tests/`)
API contract tests for both endpoints with a fake searcher: assert the `{height,width,grid}` shape passes through, point validation rejects empties, and a backend without `dense` yields 400. Run: `PYTHONPATH="" uv run pytest tests/`.

---

## 3. Frontend component decomposition

All under existing conventions. **New files:**

| File | Export | Responsibility |
|---|---|---|
| `hooks/use-region-search.ts` | `useRegionSearch` | Holds the active `RegionQuery`, `results`, `isSearching`, `unavailable`. Exposes `runText(text, bagPaths, topK)`, `runImage(file, points, bagPaths, topK)`, `runFrame(filePath, points, bagPaths, topK)`, `clear`, `fetchHeatmap(target)`. Scope (`bagPaths`, `topK`) is passed in at call time — mirrors today's `useSearch.runSearch(bagPaths, q, topK)`. In-memory only. |
| `components/search/search-mode-toggle.tsx` | `SearchModeToggle` | Segmented Global/Region control. |
| `components/search/region-support-dialog.tsx` | `RegionSupportDialog` | Modal (reuses `ui/dialog`) wrapping the canvas; loads a support image (upload `File` or promoted frame path via `fetchImageAsObjectUrl`), confirms with "Done". |
| `components/search/region-point-canvas.tsx` | `RegionPointCanvas` | Renders support image (object-**contain**) + dots; click-to-add, click-dot-to-remove, "clear all"; emits normalized `(x,y)∈[0,1]`. |
| `components/search/region-support-chip.tsx` | `RegionSupportChip` | Compact "▣ ●●N ✕" chip beside the search bar; click reopens the dialog, ✕ clears. |
| `components/search/region-result-lightbox.tsx` | `RegionResultLightbox` | Large frame (`AuthImage`, object-contain), heatmap toggle + opacity slider, ←/→ stepping over `results`, "Open in Explorer ↗", "Use as region support". |
| `components/search/heatmap-overlay.tsx` | `HeatmapOverlay` | Draws a `number[][]` grid to a `<canvas>` over the displayed image box, normalized + colormapped, at a given opacity. |
| `lib/heatmap.ts` | `gridToImageData` (+ colormap) | Pure: normalize cosine grid → colormap → `ImageData`. Kept pure for a later unit test. |

**Modified files:**
- `pages/search.tsx` — host `SearchModeToggle`; in Region mode render the region input row (text bar + ＋img + `RegionSupportChip`) and the region results grid with `onResultClick`→lightbox; render `RegionResultLightbox`. Global mode path is untouched.
- `api/client.ts` — add the six region functions (§5).
- `api/types.ts` — add `Point` and `HeatmapResponse`; region results reuse `SearchResult`.
- `components/search/image-card.tsx` — additive optional `onUseAsRegionSupport?: (result) => void` prop → renders an extra icon action when present. Global search passes nothing; behavior unchanged.

---

## 4. State model

`RegionQuery` is a discriminated union, held in `useRegionSearch`, **ephemeral** (clears on navigation, like image search today). It drives both the search call and the heatmap call:

```ts
type RegionQuery =
  | { kind: "text"; text: string }
  | { kind: "image"; file: File; objectUrl: string; points: Point[] }
  | { kind: "frame"; filePath: string; points: Point[] };
```

- `text` → `regionSearchByText`; heatmap → `regionHeatmapByText(text, target)`
- `image` → `regionSearchByImage(file, points, …)`; heatmap → `regionHeatmapByImage(file, points, target)` (support image re-sent per heatmap fetch — acceptable; heatmaps are on-demand per result)
- `frame` → `regionSearchByFrame(filePath, points, …)` (self-excluded by backend); heatmap → `regionHeatmapByFrame(filePath, points, target)`

**What is and isn't in the URL.** Only the *region query payload* (text string, points, uploaded image) stays ephemeral — never serialized. The shared **scope/display controls keep their existing URL params** across both modes: bag selection on `?bags=`, `?topK=`, `?minScore=`, and `?mode=region` for stickiness. So `BagPickerChip` and `FilterChip` are reused unchanged; the page reads the existing URL-derived `effectiveBagPaths`/`topK` and passes them into the `runX` calls, and applies the `minScore` client-side filter to region results exactly as `useUrlSearch` does today.

The region **text bar is a separate input from the global `?q=` bar** — region text lives in component state, not `?q=`. Because no `?q=`/`?similar=` is set in region mode, the existing `useUrlSearch` fetch trigger stays idle, so the two search paths coexist without firing each other. Region `similarity_score` is a cosine in the same `[0,1]`-ish range the existing min-score filter already handles.

---

## 5. API client signatures (`api/client.ts`)

```ts
regionSearchByText(text, bagPaths, topK): Promise<SearchResponse>
regionSearchByImage(file, points, bagPaths, topK): Promise<SearchResponse>   // multipart
regionSearchByFrame(supportFilePath, points, bagPaths, topK): Promise<SearchResponse>
regionHeatmapByText(text, targetFilePath): Promise<HeatmapResponse>
regionHeatmapByFrame(supportFilePath, points, targetFilePath): Promise<HeatmapResponse>
regionHeatmapByImage(file, points, targetFilePath): Promise<HeatmapResponse>  // multipart
```

Multipart functions follow the existing `searchByImage` pattern (`FormData`, repeated `bag_paths`, `points` as a JSON string for the by-image variants). All go through `http()` so the Bearer token + 401 refresh are automatic.

```ts
interface Point { x: number; y: number }                       // normalized [0,1]
interface HeatmapResponse { height: number; width: number; grid: number[][] }
```

---

## 6. Data flows

- **Text:** type in the region bar → `runText` → results grid.
- **Upload:** ＋img → `RegionSupportDialog` (upload → `RegionPointCanvas` place points → Done) → `RegionSupportChip` → `runImage`.
- **Promote:** "Use as region support" on a card or in the lightbox → dialog opens with that frame as support → place points → Done → `runFrame`.
- **Inspect:** card click → `RegionResultLightbox` → toggle heatmap → `fetchHeatmap(target)` builds the request from the active `RegionQuery` → `HeatmapOverlay` renders (cosine grid normalized before colormap; object-contain alignment; opacity slider) → ←/→ steps through results.

---

## 7. Errors & edge cases

| Scenario | Behaviour |
|---|---|
| Active backend lacks `dense` | Region call returns 400 → set `unavailable`, show inline "Region search isn't available with the current backend" + toast; stop re-calling after the first 400. |
| Empty points on a visual query | Block "Done"/search with a hint; backend also 400s on empty points. |
| No results / all below `minScore` | Reuse existing empty-state and threshold messaging. |
| Heatmap fetch fails / unreadable image | Toast; lightbox still shows the frame without overlay. |
| Card thumbnails use object-cover (crop) | Heatmap shown only in the lightbox (object-contain) where it aligns — the reason for choosing the lightbox over inline-on-card. |
| Uploaded support image | Re-sent on each heatmap fetch (stateless backend); object URL revoked on clear/unmount. |

---

## 8. Testing & verification

- **Backend:** pytest API contract tests for the two new heatmap endpoints (`PYTHONPATH="" uv run pytest tests/`).
- **Frontend:** no test runner configured → verification is `cd frontend && npm run lint` clean + `npm run build` clean. `lib/heatmap.ts` stays pure to allow a later unit test. Manual end-to-end via the `run`/`verify` skills once a bag is region-indexed.

---

## 9. Out of scope / deferred (MVP)

- **Inline-on-card heatmap peek / "overlay all"** — H1/H3 features; lightbox-only for MVP.
- **Capability endpoint** — frontend learns `dense` availability only by getting a 400; no proactive probe.
- **URL-shareable text-region** — all region searches are ephemeral; only `?mode=region` persists.
- **By-frame from Bag Explorer** — promotion happens inside `/search`; a bag-detail "search this region" entry is a later integration.
- **Frontend refactor** — this lands in today's `/search` structure; the planned refactor will reorganize it.

---

## 10. Implementation slices (for `/plan`)

1. **Backend heatmap-by-points** — `heatmap_by_frame` + `heatmap_by_image` service methods, two routes, API contract tests.
2. **API client + types** — six region functions, `Point`, `HeatmapResponse`.
3. **`useRegionSearch` + `RegionQuery`** — state hook, ephemeral, sticky `?mode=region`.
4. **Input surface** — `SearchModeToggle`, `RegionSupportDialog`, `RegionPointCanvas`, `RegionSupportChip`; additive `onUseAsRegionSupport` on `ImageCard`.
5. **Search page wiring** — mode-aware input + region results grid in `search.tsx`.
6. **Lightbox + overlay** — `lib/heatmap.ts`, `HeatmapOverlay`, `RegionResultLightbox`; wire heatmap fetch + result stepping + promote + Open-in-Explorer.
