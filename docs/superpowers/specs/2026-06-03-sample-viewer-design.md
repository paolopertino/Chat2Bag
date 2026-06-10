# Synchronized Sample Viewer - Design Spec

**Date:** 2026-06-03
**Scope:** Add synchronized multi-camera **Sample** display for `/bags` and `/search`. Search continues to rank **Frames**; inspection displays the clicked/ranked Frame inside its synchronized Sample. `/workspace` is deprecated and intentionally unchanged.

**Source decisions (read first):**
- `CONTEXT.md` - glossary: **Bag**, **Frame**, **Camera**, **Camera layout**, **Anchor Camera**, **Sample**, **Global search**, **Region search**.
- `docs/adr/0003-per-camera-frames-no-multiview-fusion.md` - Frames remain per-camera search/index units; Samples are display-time synchronized groupings, never fused embeddings.
- `docs/superpowers/specs/2026-05-29-model-invariant-embedding-multicam.md` - metadata v3+ shape: flat per-camera Frames, per-frame `topic`, top-level `cameras[]`.
- `docs/superpowers/specs/2026-05-31-region-search-frontend-design.md` - Region search cards and heatmap inspector behavior this feature replaces/extends.
- `docs/superpowers/specs/2026-04-24-bag-explorer-design.md` - existing `/bags` route and sequence viewer behavior.

This spec consolidates the grilling session on 2026-06-03 into an implementation-ready contract.

---

## 1. Decisions

| # | Decision | Choice |
|---|---|---|
| 1 | Search ranking unit | Search results remain **Frames**. A result score belongs to one Frame and one Camera. |
| 2 | Search inspection unit | Clicking a result opens a synchronized **Sample** lightbox in `/search`. |
| 3 | Bag Explorer browsing unit | `/bags` browses Samples directly. Left/right navigation moves through time only in Bag Explorer. |
| 4 | Search lightbox navigation | Left/right navigation moves through ranked search results, not time. |
| 5 | Focus Frame | In Search, the clicked/ranked Frame is forced into its Camera tile and highlighted as the focus Frame. |
| 6 | Dynamic Cameras | Camera availability/order comes from each Bag's metadata, not from hardcoded topic assumptions. |
| 7 | Missing Camera Frame | If a Camera has no nearby Frame in a Sample, the UI renders a black placeholder tile. |
| 8 | Sample tolerance | Nearest Camera Frames must be within `0.5 / sampling_fps` seconds; otherwise that Camera is missing for the Sample. |
| 9 | Anchor Camera | Bag Explorer timeline is anchored by the first Camera in the Bag's Camera list. |
| 10 | Sample API | Add a Sample-oriented backend endpoint; keep existing `/api/bags/frames` stable. |
| 11 | Camera layout | Users can configure Camera tile placement. Normal viewing hides labels. Edit mode shows identity. |
| 12 | Layout persistence | Persist Camera layouts in frontend `localStorage`, keyed by the sorted Camera topic set. |
| 13 | Default layout | 3 Cameras default to `1x3`; other counts use deterministic grid defaults. |
| 14 | Region heatmaps | Region Sample lightbox can compute heatmaps for every visible Sample Frame, only after the Heatmap toggle is enabled. |
| 15 | Chat/extraction | Remain time-window operations centered on the inspected Sample timestamp. |
| 16 | Deprecated workspace | `/workspace` is intentionally untouched. |

---

## 2. Domain Contract

Search and browsing now use different units:

- **Frame** remains the unit of indexing, Global search ranking, Region search ranking, Map filtering, and result cards.
- **Sample** becomes the unit of visual inspection when the user wants context around a Frame.
- **Camera layout** is a user-defined display arrangement only. It never affects indexing, ranking, or synchronization.

The project must not imply that Samples are fused embeddings or ranked objects. A Sample view is contextual display around one timestamp.

---

## 3. Backend Sample API

### 3.1 Endpoint

Add:

```http
GET /api/bags/samples
```

Required query params:

```text
bag_path: string
start_ns: integer
duration_sec: float
```

Optional query params:

```text
focus_file_path: string | absent
```

`focus_file_path` is used by Search inspection. When present, the backend must:

- Resolve the exact Frame from metadata by absolute or artifact-relative file path.
- Use that Frame's `timestamp_ns` as the focused Sample timestamp.
- Force that exact Frame into its Camera tile, even if nearest-timestamp lookup would otherwise pick another same-Camera Frame.
- Mark that Frame as `is_focus: true`.

Bag Explorer normally omits `focus_file_path`; it navigates by Anchor Camera timestamps.

### 3.2 Response Shape

Conceptual TypeScript shape:

```ts
interface SampleFrameInfo {
  timestamp_ns: number;
  topic: string;
  file_path: string;
  delta_ns: number;
  is_focus?: boolean;
}

interface SampleInfo {
  timestamp_ns: number;
  anchor_frame: SampleFrameInfo | null;
  frames_by_camera: Record<string, SampleFrameInfo>;
}

interface SamplesResponse {
  bag_path: string;
  cameras: string[];
  anchor_camera: string | null;
  sample_tolerance_ns: number;
  samples: SampleInfo[];
}
```

Notes:

- `cameras[]` is dynamic per Bag.
- `frames_by_camera` omits missing Cameras. The UI renders placeholders using `cameras[]`.
- `file_path` is absolute and compatible with the existing `/api/image?path=...` endpoint.
- `delta_ns` is `frame.timestamp_ns - sample.timestamp_ns`.

### 3.3 Camera List

For each Bag:

1. Use `metadata.cameras[]` when present, preserving its order.
2. If absent, derive the Camera list from `frames[].topic` in first-seen order.
3. Never assume a fixed front-left/front-center/front-right rig.

The Anchor Camera is the first Camera in this Bag-specific Camera list.

### 3.4 Sample Construction

For Bag Explorer browsing:

1. Select Anchor Camera Frames whose timestamps fall inside `[start_ns, start_ns + duration_sec]`.
2. Each Anchor Camera Frame creates one Sample timestamp.
3. For every Camera in `cameras[]`, choose the nearest Frame to the Sample timestamp.
4. Include that Frame only when `abs(delta_ns) <= sample_tolerance_ns`.
5. If the Anchor Camera itself has no Frame for a timestamp, do not create that Sample.

For Search focused inspection:

1. Find the focus Frame by `focus_file_path`.
2. Use the focus Frame timestamp as the Sample timestamp for the focused Sample.
3. Force the focus Frame into `frames_by_camera[focus.topic]`.
4. Fill all other Cameras by nearest Frame within tolerance.
5. Search lightbox consumes the focused Sample. If additional Samples are returned because the caller requested a wider time window, Search does not use them for lightbox navigation; navigation still moves through ranked results.

### 3.5 Tolerance

Default:

```text
sample_tolerance_sec = 0.5 / ingestion.sampling_fps
sample_tolerance_ns = sample_tolerance_sec * 1e9
```

With current `sampling_fps: 1.0`, this is `+/-500 ms`.

This is intentionally a display synchronization tolerance. It is separate from GPS `gps_max_gap_sec` and from any nuScenes extraction service synchronizer.

---

## 4. Shared Sample Viewer

Add one shared Sample viewer component used by both `/bags` and `/search`.

Responsibilities:

- Render a dynamic Camera tile set from `cameras[]`.
- Render black placeholders for Cameras missing from `frames_by_camera`.
- Use the saved Camera layout when available.
- Fall back to deterministic default layout.
- Support layout edit mode.
- Highlight the focus Frame when present.
- Support optional Region heatmap overlays.

Normal viewing hides Camera labels. Edit mode shows Camera identity so users can place tiles correctly.

---

## 5. Camera Layout

### 5.1 Persistence

Persist in `localStorage`.

Key:

```text
sample-camera-layout:<hash-or-joined-sorted-camera-topics>
```

The key must use the sorted Camera topic set so Bags with the same rig reuse the same layout even if metadata order differs.

Stored shape:

```ts
interface CameraLayout {
  version: 1;
  cameras: string[];
  slots: Record<string, { row: number; col: number }>;
}
```

If the saved layout does not cover the current Camera set exactly, ignore it and use the default layout.

### 5.2 Default Layouts

When no saved layout exists:

| Camera count | Default |
|---:|---|
| 1 | `1x1` |
| 2 | `1x2` |
| 3 | `1x3` |
| 4 | `2x2` |
| 5-6 | `2x3` |
| >6 | 3 columns, as many rows as needed |

The default for the current three-front-camera rig is therefore a single row.

### 5.3 Editing

First version uses a slot editor rather than freeform drag/drop.

Expected controls:

- Enter/exit layout edit mode.
- Show Camera identity only in edit mode.
- Move a Camera tile between grid slots with simple controls.
- Save layout to `localStorage`.
- Reset to default layout.

No drag/drop dependency is required for the first version.

---

## 6. Bag Explorer Behavior

`/bags/:bagId` switches from single-Frame sequence viewing to Sample browsing.

Main changes:

- The main viewing area displays the full Sample according to Camera layout.
- The selected unit is a Sample timestamp.
- Left/right arrow keys move to previous/next Sample in time.
- The thumbnail strip shows Anchor Camera thumbnails only.
- Each thumbnail includes a small coverage indicator such as `3/3` or `2/3`.
- Loading older/newer chunks loads more Samples via `/api/bags/samples`.
- Missing Camera tiles render black placeholders.

The timeline must not render tiny multi-camera composites; they are too hard to read and visually noisy.

Chat and extraction launched from Bag Explorer use the selected Sample timestamp. In practice this is the Anchor Camera timestamp for the selected Sample.

---

## 7. Search Behavior

Search results remain Frame cards.

### 7.1 Global Search

- Result cards still represent individual Frames.
- Normal click opens the Sample lightbox in `/search`.
- No heatmap controls are shown.
- The clicked Frame is highlighted in its Camera tile.
- The lightbox includes an explicit "Open in Explorer" action for the same Bag and timestamp.

### 7.2 Region Search

- Result cards still represent individual Frames and their Region score.
- Normal click opens the same Sample lightbox.
- Heatmap controls are available because the active query is a Region query.
- The clicked/ranked Frame is highlighted.
- Heatmaps can be computed for every visible non-missing Sample Frame after the user toggles Heatmap on.
- The lightbox includes "Open in Explorer".

### 7.3 Search Lightbox Navigation

Left/right arrows in Search move through ranked results:

- Previous result opens that result's focused Sample.
- Next result opens that result's focused Sample.
- They do not move through time within a Bag.

This keeps Search focused on result comparison. Temporal browsing remains Bag Explorer's job.

---

## 8. Region Heatmaps Across a Sample

The existing frontend `fetchHeatmap(targetFilePath)` model can apply the active Region query to any target Frame. Reuse that behavior.

Rules:

- Do not compute heatmaps when result cards render.
- Do not compute heatmaps when the Sample lightbox first opens.
- When the user toggles Heatmap on, fetch heatmaps for visible Sample Frames in parallel.
- Cache heatmaps by `file_path`.
- Show per-tile loading state.
- Missing black placeholder tiles have no heatmap.
- If a heatmap request fails for one tile, keep the other heatmaps visible.

This avoids extra dense passes unless the user explicitly asks for them.

---

## 9. API / Type Changes

Frontend API additions:

- `getSamples(bagPath, startNs, durationSec, focusFilePath?)`
- `SampleFrameInfo`
- `SampleInfo`
- `SamplesResponse`

Existing types remain valid:

- `SearchResult` stays Frame-shaped.
- `FrameInfo` can remain for the deprecated `/frames` sequence path until replaced in `/bags`.
- Existing `/api/bags/frames` remains stable.

---

## 10. Non-Goals

- No changes to `/workspace`; it is deprecated.
- No fused multi-camera embeddings.
- No Sample ranking.
- No backend user-preferences store for Camera layout.
- No freeform drag/drop layout editor in v1.
- No automatic Region heatmap precomputation.
- No changes to ingestion, indexing, Global search, Region search ranking, Map search, auth, or extraction service contracts.

---

## 11. Implementation Slices

Recommended implementation order:

1. Backend `/api/bags/samples` + tests for dynamic Cameras, tolerance, missing Cameras, and focus Frame preservation.
2. Frontend API/types for Samples.
3. Camera layout utilities and `localStorage` persistence.
4. Shared `SampleViewer` with default layouts, placeholders, focus highlighting, and layout edit mode.
5. Migrate `/bags/:bagId` to Sample browsing.
6. Add Search Sample lightbox for Global results.
7. Replace Region result lightbox with Sample lightbox + optional per-tile heatmaps.
8. Verify chat/extraction center timestamp behavior.

---

## 12. Verification Plan

Backend:

```bash
uv run pytest tests/test_bags_samples.py
uv run pytest tests/test_bags_track.py tests/test_api_contracts.py
```

Frontend:

```bash
cd frontend && npm run build
cd frontend && npm run lint
```

Manual browser checks:

- Bag with three Cameras defaults to `1x3`.
- Bag with a missing Camera Frame shows a black placeholder.
- Bag Explorer arrows move through time.
- Search result click opens in-page Sample lightbox.
- Search lightbox arrows move through ranked results.
- Region Sample heatmap toggle computes overlays only on visible Frames.
- "Open in Explorer" lands on the same Bag/timestamp.

