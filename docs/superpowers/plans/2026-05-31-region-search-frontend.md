# Region Search Frontend (Slice 6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Region search to the existing `/search` page as a Global ⇄ Region mode toggle — text / uploaded-image+points / promoted-frame+points queries, a modal point canvas, and a lightbox heatmap inspector.

**Architecture:** One small backend addition (point/frame heatmap endpoints) plus a frontend that folds into `/search`. Region query state is ephemeral and held in a `useRegionSearch` hook; only `?mode=region` is sticky. Results reuse the existing grid/card; the heatmap renders only in a new lightbox (object-contain) where it can align with the frame.

**Tech Stack:** Backend — FastAPI, Pydantic v2, pytest + httpx TestClient. Frontend — React 19, Vite, TailwindCSS, React Router v6, Radix UI primitives. No frontend test runner (per `CLAUDE.md`) → frontend tasks verify with `npm run lint` + `npm run build`.

**Spec:** `docs/superpowers/specs/2026-05-31-region-search-frontend-design.md`

**Conventions:** kebab-case files, PascalCase components, named exports; relative imports inside `components/search/`; all network calls go through `http()` in `src/api/client.ts`; auth images via `AuthImage`/`fetchImageAsObjectUrl`.

---

## File structure

**Backend (modify):**
- `src/services/region_search_service.py` — add `heatmap_by_frame`, `heatmap_by_image`.
- `src/api/search_routes.py` — add `/search/region/heatmap/by-frame`, `/search/region/heatmap/by-image` + request model.
- `tests/test_region_api.py` — add service + route tests; extend `_SvcStub`.

**Frontend (create):**
- `frontend/src/hooks/use-region-search.ts` — `useRegionSearch`, `RegionQuery`.
- `frontend/src/lib/heatmap.ts` — pure colormap/grid helpers.
- `frontend/src/components/search/heatmap-overlay.tsx` — `HeatmapOverlay`.
- `frontend/src/components/search/region-point-canvas.tsx` — `RegionPointCanvas`.
- `frontend/src/components/search/region-support-dialog.tsx` — `RegionSupportDialog`, `RegionSupport`.
- `frontend/src/components/search/region-support-chip.tsx` — `RegionSupportChip`.
- `frontend/src/components/search/search-mode-toggle.tsx` — `SearchModeToggle`, `SearchMode`.
- `frontend/src/components/search/region-result-lightbox.tsx` — `RegionResultLightbox`.

**Frontend (modify):**
- `frontend/src/api/types.ts` — add `Point`, `HeatmapResponse`.
- `frontend/src/api/client.ts` — add 6 region functions.
- `frontend/src/components/search/image-card.tsx` — additive `onUseAsRegionSupport` prop.
- `frontend/src/components/search/results-grid.tsx` — forward `onUseAsRegionSupport`.
- `frontend/src/pages/search.tsx` — mode-aware input, region results, dialog, lightbox.

Slice mapping (spec §10): Task 1–2 = slice 1; Task 3 = slice 2; Task 4 = slice 3; Tasks 5,8 = slice 6; Tasks 6,7 = slice 4; Task 9 = slice 5.

---

## Task 1: Backend — heatmap-by-points service methods (TDD)

**Files:**
- Modify: `src/services/region_search_service.py`
- Test: `tests/test_region_api.py`

- [ ] **Step 1: Write the failing service tests**

Add to `tests/test_region_api.py` (top: add `import io as _io` and `from PIL import Image as PILImage` near the existing imports; `pytest` is already imported):

```python
class _HeatStubSearcher:
    def heatmap_for_points(self, image, points, target_file_path):
        return {"height": 2, "width": 3, "grid": [[0.0, 0.0, 0.0], [0.0, 0.0, 0.0]],
                "n_points": len(points), "target": target_file_path}


def test_service_heatmap_by_frame_delegates(tmp_path):
    support = tmp_path / "support.png"
    PILImage.new("RGB", (8, 8), (123, 50, 200)).save(support)
    svc = RegionSearchService(_HeatStubSearcher())
    out = svc.heatmap_by_frame(
        support_file_path=str(support), points=[{"x": 0.5, "y": 0.5}],
        target_file_path="/b/t.jpg",
    )
    assert out["target"] == "/b/t.jpg"
    assert out["n_points"] == 1


def test_service_heatmap_by_image_delegates():
    buf = _io.BytesIO()
    PILImage.new("RGB", (8, 8), (10, 20, 30)).save(buf, format="PNG")
    svc = RegionSearchService(_HeatStubSearcher())
    out = svc.heatmap_by_image(
        image_bytes=buf.getvalue(), points=[{"x": 0.1, "y": 0.2}],
        target_file_path="/b/t.jpg",
    )
    assert out["n_points"] == 1


def test_service_heatmap_rejects_empty_target():
    svc = RegionSearchService(_HeatStubSearcher())
    with pytest.raises(ValueError):
        svc.heatmap_by_image(image_bytes=b"x", points=[], target_file_path="  ")
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `PYTHONPATH="" uv run pytest tests/test_region_api.py -k heatmap_by -v`
Expected: FAIL — `AttributeError: 'RegionSearchService' object has no attribute 'heatmap_by_frame'`.

- [ ] **Step 3: Implement the two methods**

Append to `src/services/region_search_service.py` inside the `RegionSearchService` class (after `heatmap_by_text`). `io` and `Path` are already imported at the top of the file:

```python
    def heatmap_by_frame(self, support_file_path: str, points: list[dict], target_file_path: str) -> dict:
        if not support_file_path.strip():
            raise ValueError("support_file_path must not be empty.")
        if not target_file_path.strip():
            raise ValueError("target_file_path must not be empty.")
        image = Image.open(Path(support_file_path).expanduser().resolve()).convert("RGB")
        return self._searcher.heatmap_for_points(
            image=image, points=points, target_file_path=target_file_path,
        )

    def heatmap_by_image(self, image_bytes: bytes, points: list[dict], target_file_path: str) -> dict:
        if not target_file_path.strip():
            raise ValueError("target_file_path must not be empty.")
        if not image_bytes:
            raise ValueError("Image payload is empty.")
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        return self._searcher.heatmap_for_points(
            image=image, points=points, target_file_path=target_file_path,
        )
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `PYTHONPATH="" uv run pytest tests/test_region_api.py -k heatmap_by -v`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/services/region_search_service.py tests/test_region_api.py
git commit -m "[Backend] Region heatmap-by-points service methods"
```

---

## Task 2: Backend — heatmap-by-points routes (TDD)

**Files:**
- Modify: `src/api/search_routes.py`
- Test: `tests/test_region_api.py`

- [ ] **Step 1: Write the failing route tests**

In `tests/test_region_api.py`, add `import json` at the top. Extend `_SvcStub` with two methods (add inside the existing `_SvcStub` class):

```python
    def heatmap_by_frame(self, support_file_path, points, target_file_path):
        return {"height": 2, "width": 3, "grid": [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]]}

    def heatmap_by_image(self, image_bytes, points, target_file_path):
        return {"height": 2, "width": 3, "grid": [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]]}
```

Add two route tests:

```python
def test_region_heatmap_by_frame_endpoint(bypass_auth):
    client = _client_with_stub(bypass_auth, _SvcStub())
    resp = client.post("/api/search/region/heatmap/by-frame", json={
        "support_file_path": "/b/.bag_chat/thumbnails/cam_a/frame_1.jpg",
        "points": [{"x": 0.5, "y": 0.5}],
        "target_file_path": "/b/.bag_chat/thumbnails/cam_a/frame_9.jpg",
    })
    assert resp.status_code == 200
    body = resp.json()
    assert body["height"] == 2 and body["width"] == 3


def test_region_heatmap_by_image_endpoint(bypass_auth):
    client = _client_with_stub(bypass_auth, _SvcStub())
    resp = client.post(
        "/api/search/region/heatmap/by-image",
        data={"points": json.dumps([{"x": 0.5, "y": 0.5}]),
              "target_file_path": "/b/.bag_chat/thumbnails/cam_a/frame_9.jpg"},
        files={"image": ("s.png", b"fake-image-bytes", "image/png")},
    )
    assert resp.status_code == 200
    assert resp.json()["width"] == 3
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `PYTHONPATH="" uv run pytest tests/test_region_api.py -k "heatmap_by_frame_endpoint or heatmap_by_image_endpoint" -v`
Expected: FAIL with `404 Not Found` (routes don't exist yet).

- [ ] **Step 3: Add the request model and routes**

In `src/api/search_routes.py`, add this request model after the existing `RegionHeatmapTextRequest` class:

```python
class RegionHeatmapByFrameRequest(BaseModel):
    support_file_path: str = Field(..., min_length=1)
    points: List[Point] = Field(..., min_length=1)
    target_file_path: str = Field(..., min_length=1)
```

Add these two routes after the existing `region_heatmap` function (end of file):

```python
@router.post("/search/region/heatmap/by-frame")
async def region_heatmap_by_frame(
    req: RegionHeatmapByFrameRequest,
    service: Annotated[RegionSearchService, Depends(get_region_search_service)],
):
    """Recomputed value-attention cosine grid for a target frame vs points on a Support Frame."""
    try:
        grid = service.heatmap_by_frame(
            support_file_path=req.support_file_path,
            points=[p.model_dump() for p in req.points],
            target_file_path=req.target_file_path,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except OSError as exc:
        raise HTTPException(status_code=400, detail="Invalid image file") from exc
    return grid


@router.post("/search/region/heatmap/by-image")
async def region_heatmap_by_image(
    service: Annotated[RegionSearchService, Depends(get_region_search_service)],
    image: UploadFile = File(...),
    points: str = Form(...),
    target_file_path: str = Form(...),
):
    """Recomputed cosine grid for a target frame vs points on an uploaded Support image."""
    import json as _json

    try:
        parsed_points = _json.loads(points)
        image_bytes = await image.read()
        grid = service.heatmap_by_image(
            image_bytes=image_bytes, points=parsed_points, target_file_path=target_file_path,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except OSError as exc:
        raise HTTPException(status_code=400, detail="Invalid image file") from exc
    return grid
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `PYTHONPATH="" uv run pytest tests/test_region_api.py -v`
Expected: all region API tests pass (existing + the 5 new ones).

- [ ] **Step 5: Run the full backend suite for regressions**

Run: `PYTHONPATH="" uv run pytest tests/`
Expected: the pre-existing 4 failures + 1 error remain (network API tests, `/api/image` auth gap, `test_indexing_service` drift — see spec/handoff); no NEW failures.

- [ ] **Step 6: Commit**

```bash
git add src/api/search_routes.py tests/test_region_api.py
git commit -m "[API] Region heatmap-by-points endpoints (by-frame, by-image)"
```

---

## Task 3: Frontend — types + API client functions

**Files:**
- Modify: `frontend/src/api/types.ts`
- Modify: `frontend/src/api/client.ts`

- [ ] **Step 1: Add types**

In `frontend/src/api/types.ts`, add after the `SearchResponse` interface:

```ts
export interface Point {
  x: number;
  y: number;
}

export interface HeatmapResponse {
  height: number;
  width: number;
  grid: number[][];
}
```

- [ ] **Step 2: Extend the client type import**

In `frontend/src/api/client.ts`, change the type import block to include `HeatmapResponse` and `Point` (add the two names to the existing `import type { ... } from "./types";`):

```ts
import type {
  ChatResponse,
  BagInfoResponse,
  BagStatusResponse,
  ExtractionConfigSchema,
  ExtractionJob,
  ExtractionLogsResponse,
  ExtractionSubmitRequest,
  ExtractionSubmitResponse,
  FramesResponse,
  HeatmapResponse,
  Point,
  ScanBagsResponse,
  SearchResponse,
} from "./types";
```

- [ ] **Step 3: Add the six region functions**

Append to the end of `frontend/src/api/client.ts`:

```ts
// ---- Region search ----

export async function regionSearchByText(
  text: string,
  bagPaths: string[],
  topK: number,
): Promise<SearchResponse> {
  return http<SearchResponse>("/api/search/region/by-text", {
    method: "POST",
    body: JSON.stringify({ text, bag_paths: bagPaths, top_k: topK }),
  });
}

export async function regionSearchByFrame(
  supportFilePath: string,
  points: Point[],
  bagPaths: string[],
  topK: number,
): Promise<SearchResponse> {
  return http<SearchResponse>("/api/search/region/by-frame", {
    method: "POST",
    body: JSON.stringify({
      support_file_path: supportFilePath,
      points,
      bag_paths: bagPaths,
      top_k: topK,
    }),
  });
}

export async function regionSearchByImage(
  file: File,
  points: Point[],
  bagPaths: string[],
  topK: number,
): Promise<SearchResponse> {
  const formData = new FormData();
  formData.append("image", file);
  formData.append("points", JSON.stringify(points));
  formData.append("top_k", String(topK));
  for (const bagPath of bagPaths) formData.append("bag_paths", bagPath);
  return http<SearchResponse>("/api/search/region/by-image", {
    method: "POST",
    body: formData,
  });
}

export async function regionHeatmapByText(
  text: string,
  targetFilePath: string,
): Promise<HeatmapResponse> {
  return http<HeatmapResponse>("/api/search/region/heatmap", {
    method: "POST",
    body: JSON.stringify({ text, target_file_path: targetFilePath }),
  });
}

export async function regionHeatmapByFrame(
  supportFilePath: string,
  points: Point[],
  targetFilePath: string,
): Promise<HeatmapResponse> {
  return http<HeatmapResponse>("/api/search/region/heatmap/by-frame", {
    method: "POST",
    body: JSON.stringify({
      support_file_path: supportFilePath,
      points,
      target_file_path: targetFilePath,
    }),
  });
}

export async function regionHeatmapByImage(
  file: File,
  points: Point[],
  targetFilePath: string,
): Promise<HeatmapResponse> {
  const formData = new FormData();
  formData.append("image", file);
  formData.append("points", JSON.stringify(points));
  formData.append("target_file_path", targetFilePath);
  return http<HeatmapResponse>("/api/search/region/heatmap/by-image", {
    method: "POST",
    body: formData,
  });
}
```

- [ ] **Step 4: Verify lint + build**

Run: `cd frontend && npm run lint && npm run build`
Expected: no lint errors, build succeeds (no unused-import or type errors).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/types.ts frontend/src/api/client.ts
git commit -m "[UI] Region search + heatmap API client and types"
```

---

## Task 4: Frontend — useRegionSearch hook + RegionQuery

**Files:**
- Create: `frontend/src/hooks/use-region-search.ts`

- [ ] **Step 1: Write the hook**

Create `frontend/src/hooks/use-region-search.ts`:

```ts
import { useCallback, useState } from "react";
import { toast } from "sonner";

import {
  regionHeatmapByFrame,
  regionHeatmapByImage,
  regionHeatmapByText,
  regionSearchByFrame,
  regionSearchByImage,
  regionSearchByText,
} from "../api/client";
import type { HeatmapResponse, Point, SearchResult } from "../api/types";

export type RegionQuery =
  | { kind: "text"; text: string }
  | { kind: "image"; file: File; objectUrl: string; points: Point[] }
  | { kind: "frame"; filePath: string; points: Point[] };

function isUnavailable(error: unknown): boolean {
  return error instanceof Error && error.message.toLowerCase().includes("not available");
}

export function useRegionSearch() {
  const [query, setQuery] = useState<RegionQuery | null>(null);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  const clear = useCallback(() => {
    setQuery(null);
    setResults([]);
  }, []);

  const run = useCallback(
    async (next: RegionQuery, fetcher: () => Promise<SearchResult[]>) => {
      setIsSearching(true);
      setQuery(next);
      try {
        const rows = await fetcher();
        setResults(rows);
      } catch (error) {
        if (isUnavailable(error)) setUnavailable(true);
        setResults([]);
        toast.error(error instanceof Error ? error.message : "Region search failed.");
      } finally {
        setIsSearching(false);
      }
    },
    [],
  );

  const runText = useCallback(
    (text: string, bagPaths: string[], topK: number) => {
      if (!text.trim()) {
        toast.error("Enter a region query.");
        return;
      }
      if (bagPaths.length === 0) {
        toast.error("Select at least one bag.");
        return;
      }
      void run({ kind: "text", text: text.trim() }, async () =>
        (await regionSearchByText(text.trim(), bagPaths, topK)).results,
      );
    },
    [run],
  );

  const runImage = useCallback(
    (file: File, objectUrl: string, points: Point[], bagPaths: string[], topK: number) => {
      if (points.length === 0) {
        toast.error("Place at least one point on the support image.");
        return;
      }
      if (bagPaths.length === 0) {
        toast.error("Select at least one bag.");
        return;
      }
      void run({ kind: "image", file, objectUrl, points }, async () =>
        (await regionSearchByImage(file, points, bagPaths, topK)).results,
      );
    },
    [run],
  );

  const runFrame = useCallback(
    (filePath: string, points: Point[], bagPaths: string[], topK: number) => {
      if (points.length === 0) {
        toast.error("Place at least one point on the support frame.");
        return;
      }
      if (bagPaths.length === 0) {
        toast.error("Select at least one bag.");
        return;
      }
      void run({ kind: "frame", filePath, points }, async () =>
        (await regionSearchByFrame(filePath, points, bagPaths, topK)).results,
      );
    },
    [run],
  );

  const fetchHeatmap = useCallback(
    async (targetFilePath: string): Promise<HeatmapResponse | null> => {
      if (!query) return null;
      try {
        if (query.kind === "text") return await regionHeatmapByText(query.text, targetFilePath);
        if (query.kind === "frame")
          return await regionHeatmapByFrame(query.filePath, query.points, targetFilePath);
        return await regionHeatmapByImage(query.file, query.points, targetFilePath);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Heatmap unavailable.");
        return null;
      }
    },
    [query],
  );

  return {
    query,
    results,
    isSearching,
    unavailable,
    runText,
    runImage,
    runFrame,
    clear,
    fetchHeatmap,
  };
}
```

- [ ] **Step 2: Verify lint + build**

Run: `cd frontend && npm run lint && npm run build`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/use-region-search.ts
git commit -m "[UI] useRegionSearch hook + RegionQuery model"
```

---

## Task 5: Frontend — heatmap colormap lib + HeatmapOverlay

**Files:**
- Create: `frontend/src/lib/heatmap.ts`
- Create: `frontend/src/components/search/heatmap-overlay.tsx`

- [ ] **Step 1: Write the pure heatmap helpers**

Create `frontend/src/lib/heatmap.ts`:

```ts
/** Map a value in [0,1] to an [r,g,b] blue→cyan→yellow→red ramp. */
export function colormap(t: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, t));
  const r = Math.round(255 * Math.min(1, Math.max(0, 1.5 - Math.abs(4 * x - 3))));
  const g = Math.round(255 * Math.min(1, Math.max(0, 1.5 - Math.abs(4 * x - 2))));
  const b = Math.round(255 * Math.min(1, Math.max(0, 1.5 - Math.abs(4 * x - 1))));
  return [r, g, b];
}

/** Min-max normalize a cosine grid (values may be slightly negative) to [0,1]. */
export function normalizeGrid(grid: number[][]): number[][] {
  let min = Infinity;
  let max = -Infinity;
  for (const row of grid) {
    for (const v of row) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  const span = max - min || 1;
  return grid.map((row) => row.map((v) => (v - min) / span));
}

/**
 * Render a (height x width) cosine grid into an RGBA ImageData at patch
 * resolution. Alpha encodes intensity so cool regions stay transparent.
 */
export function gridToImageData(grid: number[][], width: number, height: number): ImageData {
  const norm = normalizeGrid(grid);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const t = norm[y]?.[x] ?? 0;
      const [r, g, b] = colormap(t);
      const idx = (y * width + x) * 4;
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = Math.round(255 * t);
    }
  }
  return new ImageData(data, width, height);
}
```

- [ ] **Step 2: Write the overlay component**

Create `frontend/src/components/search/heatmap-overlay.tsx`:

```tsx
import { useEffect, useRef } from "react";

import type { HeatmapResponse } from "../../api/types";
import { gridToImageData } from "../../lib/heatmap";

interface HeatmapOverlayProps {
  heatmap: HeatmapResponse;
  /** 0..1 */
  opacity: number;
  className?: string;
}

export function HeatmapOverlay({ heatmap, opacity, className }: HeatmapOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const imageData = gridToImageData(heatmap.grid, heatmap.width, heatmap.height);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.putImageData(imageData, 0, 0);
  }, [heatmap]);

  // Backing store is at patch resolution; CSS stretches it to the image box
  // (bilinear smoothing). pointerEvents none so the image underneath stays interactive.
  return (
    <canvas
      ref={canvasRef}
      width={heatmap.width}
      height={heatmap.height}
      className={className}
      style={{ opacity, width: "100%", height: "100%", pointerEvents: "none" }}
    />
  );
}
```

- [ ] **Step 3: Verify lint + build**

Run: `cd frontend && npm run lint && npm run build`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/heatmap.ts frontend/src/components/search/heatmap-overlay.tsx
git commit -m "[UI] Heatmap colormap lib + HeatmapOverlay canvas"
```

---

## Task 6: Frontend — point canvas + support dialog + support chip

**Files:**
- Create: `frontend/src/components/search/region-point-canvas.tsx`
- Create: `frontend/src/components/search/region-support-dialog.tsx`
- Create: `frontend/src/components/search/region-support-chip.tsx`

- [ ] **Step 1: Write the point canvas**

Create `frontend/src/components/search/region-point-canvas.tsx`:

```tsx
import { X } from "lucide-react";
import { useRef, type MouseEvent } from "react";

import type { Point } from "../../api/types";

interface RegionPointCanvasProps {
  src: string;
  alt: string;
  points: Point[];
  onChange: (points: Point[]) => void;
}

export function RegionPointCanvas({ src, alt, points, onChange }: RegionPointCanvasProps) {
  const imgRef = useRef<HTMLImageElement | null>(null);

  const handleClick = (e: MouseEvent<HTMLImageElement>) => {
    const img = imgRef.current;
    if (!img) return;
    const rect = img.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    onChange([...points, { x, y }]);
  };

  const removePoint = (index: number) => {
    onChange(points.filter((_, i) => i !== index));
  };

  return (
    <div className="relative inline-block select-none">
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        onClick={handleClick}
        draggable={false}
        className="block max-h-[60vh] max-w-full cursor-crosshair rounded-md"
      />
      {points.map((p, i) => (
        <button
          key={`${p.x.toFixed(4)}-${p.y.toFixed(4)}-${i}`}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            removePoint(i);
          }}
          title="Remove point"
          aria-label={`Remove point ${i + 1}`}
          className="absolute flex h-4 w-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white bg-[var(--teal)] text-white shadow"
          style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
        >
          <X className="h-2.5 w-2.5" />
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Write the support dialog**

Create `frontend/src/components/search/region-support-dialog.tsx`:

```tsx
import { Eraser } from "lucide-react";
import { useEffect, useState } from "react";

import { fetchImageAsObjectUrl } from "../../api/client";
import type { Point } from "../../api/types";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { RegionPointCanvas } from "./region-point-canvas";

export type RegionSupport =
  | { kind: "image"; file: File; objectUrl: string }
  | { kind: "frame"; filePath: string };

interface RegionSupportDialogProps {
  open: boolean;
  support: RegionSupport | null;
  initialPoints: Point[];
  onClose: () => void;
  onConfirm: (points: Point[]) => void;
}

export function RegionSupportDialog({
  open,
  support,
  initialPoints,
  onClose,
  onConfirm,
}: RegionSupportDialogProps) {
  const [points, setPoints] = useState<Point[]>(initialPoints);
  const [frameUrl, setFrameUrl] = useState<string | null>(null);

  // Reset points whenever a new support is opened.
  useEffect(() => {
    setPoints(initialPoints);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [support]);

  // Promoted frames need an auth blob URL to display.
  useEffect(() => {
    if (support?.kind !== "frame") {
      setFrameUrl(null);
      return;
    }
    let url: string | null = null;
    let cancelled = false;
    fetchImageAsObjectUrl(support.filePath)
      .then((fetched) => {
        if (cancelled) {
          URL.revokeObjectURL(fetched);
          return;
        }
        url = fetched;
        setFrameUrl(fetched);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [support]);

  const src = support?.kind === "image" ? support.objectUrl : frameUrl;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Place region points</DialogTitle>
          <DialogDescription>
            Click the support image to mark the region(s) you want to find. Click a point to remove it.
          </DialogDescription>
        </DialogHeader>

        <div className="flex justify-center">
          {src ? (
            <RegionPointCanvas src={src} alt="Region support" points={points} onChange={setPoints} />
          ) : (
            <div className="flex h-48 w-full items-center justify-center text-sm text-[var(--ink-soft)]">
              Loading support image…
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-[var(--ink-soft)]">
            {points.length} point{points.length === 1 ? "" : "s"} placed
          </span>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setPoints([])}
              disabled={points.length === 0}
            >
              <Eraser className="mr-1.5 h-3.5 w-3.5" /> Clear
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={() => onConfirm(points)} disabled={points.length === 0}>
              Done
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Write the support chip**

Create `frontend/src/components/search/region-support-chip.tsx`:

```tsx
import { Image as ImageIcon, X } from "lucide-react";

interface RegionSupportChipProps {
  thumbnailUrl: string | null;
  pointCount: number;
  onEdit: () => void;
  onClear: () => void;
}

export function RegionSupportChip({ thumbnailUrl, pointCount, onEdit, onClear }: RegionSupportChipProps) {
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--bg-paper)] py-1 pl-1 pr-2 text-xs">
      <button type="button" onClick={onEdit} className="flex items-center gap-2" title="Edit region points">
        {thumbnailUrl ? (
          <img src={thumbnailUrl} alt="Support" className="h-6 w-6 rounded-full object-cover" />
        ) : (
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--bg-sand)]">
            <ImageIcon className="h-3.5 w-3.5" />
          </span>
        )}
        <span>{pointCount} point{pointCount === 1 ? "" : "s"}</span>
      </button>
      <button
        type="button"
        onClick={onClear}
        title="Clear region support"
        aria-label="Clear region support"
        className="text-[var(--ink-soft)] hover:text-[var(--ink)]"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Verify lint + build**

Run: `cd frontend && npm run lint && npm run build`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/search/region-point-canvas.tsx frontend/src/components/search/region-support-dialog.tsx frontend/src/components/search/region-support-chip.tsx
git commit -m "[UI] Region point canvas, support dialog, support chip"
```

---

## Task 7: Frontend — mode toggle + ImageCard/ResultsGrid promote action

**Files:**
- Create: `frontend/src/components/search/search-mode-toggle.tsx`
- Modify: `frontend/src/components/search/image-card.tsx`
- Modify: `frontend/src/components/search/results-grid.tsx`

- [ ] **Step 1: Write the mode toggle**

Create `frontend/src/components/search/search-mode-toggle.tsx`:

```tsx
export type SearchMode = "global" | "region";

interface SearchModeToggleProps {
  mode: SearchMode;
  onChange: (mode: SearchMode) => void;
}

const MODES: { value: SearchMode; label: string }[] = [
  { value: "global", label: "Global" },
  { value: "region", label: "Region" },
];

export function SearchModeToggle({ mode, onChange }: SearchModeToggleProps) {
  return (
    <div className="inline-flex shrink-0 rounded-lg border border-[var(--line)] bg-[var(--bg-paper)] p-0.5">
      {MODES.map((m) => (
        <button
          key={m.value}
          type="button"
          onClick={() => onChange(m.value)}
          aria-pressed={mode === m.value}
          className={
            "rounded-md px-3 py-1 text-xs font-medium transition-colors " +
            (mode === m.value
              ? "bg-[var(--teal)] text-white"
              : "text-[var(--ink-soft)] hover:text-[var(--ink)]")
          }
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Add the promote action to ImageCard**

Replace the entire contents of `frontend/src/components/search/image-card.tsx` with (adds an optional `onUseAsRegionSupport` prop + a crosshair action button; everything else unchanged):

```tsx
import { useCallback, useState } from "react";
import { Crosshair, Search } from "lucide-react";
import { Link } from "react-router-dom";

import type { SearchResult } from "../../api/types";
import { Button } from "../ui/button";
import { Card, CardContent } from "../ui/card";
import { AuthImage } from "../ui/auth-image";

function formatTimestampNs(ns: number): string {
  const ms = Math.floor(ns / 1_000_000);
  return `${ms.toLocaleString()} ms`;
}

interface ImageCardProps {
  result: SearchResult;
  /** When provided, renders the image area as a `<Link>` so Cmd/Ctrl-click opens a new tab. */
  href?: string;
  onClick?: () => void;
  onSimilarSearch?: (result: SearchResult) => void;
  /** Region mode: promote this frame to a region support image. */
  onUseAsRegionSupport?: (result: SearchResult) => void;
}

export function ImageCard({ result, href, onClick, onSimilarSearch, onUseAsRegionSupport }: ImageCardProps) {
  const filePath = result.file_path;
  const [hasImageError, setHasImageError] = useState(false);
  const handleImageError = useCallback(() => setHasImageError(true), []);

  const imageArea = hasImageError ? (
    <div className="flex aspect-video w-full items-center justify-center bg-[var(--bg-sand)] text-sm text-[var(--ink-soft)]">
      Preview unavailable
    </div>
  ) : (
    <AuthImage
      filePath={filePath}
      alt={`Search result from ${result.source_bag}`}
      onError={handleImageError}
      className="aspect-video w-full bg-[var(--bg-sand)] object-cover"
    />
  );

  return (
    <Card className="overflow-hidden transition hover:-translate-y-0.5">
      {href ? (
        <Link to={href} className="block w-full text-left">
          {imageArea}
        </Link>
      ) : (
        <button type="button" onClick={onClick} className="block w-full cursor-pointer text-left">
          {imageArea}
        </button>
      )}
      <CardContent className="p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <p className="truncate text-sm font-semibold">{result.source_bag}</p>
            <p className="font-mono text-xs text-[var(--ink-soft)]">score {(result.similarity_score * 100).toFixed(2)}%</p>
            <p className="font-mono text-xs text-[var(--ink-soft)]">t = {formatTimestampNs(result.timestamp_ns)}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {onUseAsRegionSupport ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                title="Use as region support"
                aria-label="Use as region support"
                onClick={(event) => {
                  event.stopPropagation();
                  onUseAsRegionSupport(result);
                }}
              >
                <Crosshair className="h-4 w-4" />
              </Button>
            ) : null}
            {onSimilarSearch ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                title="Find similar images"
                aria-label="Find similar images"
                onClick={(event) => {
                  event.stopPropagation();
                  onSimilarSearch(result);
                }}
              >
                <Search className="h-4 w-4" />
              </Button>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Forward the prop through ResultsGrid**

Replace the entire contents of `frontend/src/components/search/results-grid.tsx` with (adds `onUseAsRegionSupport` to props and forwards it):

```tsx
import type { SearchResult } from "../../api/types";
import { ImageCard } from "./image-card";
import { Skeleton } from "../ui/skeleton";

interface ResultsGridProps {
  results: SearchResult[];
  isSearching: boolean;
  onResultClick?: (result: SearchResult) => void;
  onSimilarSearch?: (result: SearchResult) => void;
  onUseAsRegionSupport?: (result: SearchResult) => void;
  /** When provided, each card renders as a `<Link>` enabling Cmd/Ctrl-click → new tab. */
  getResultHref?: (result: SearchResult) => string;
}

export function ResultsGrid({
  results,
  isSearching,
  onResultClick,
  onSimilarSearch,
  onUseAsRegionSupport,
  getResultHref,
}: ResultsGridProps) {
  if (isSearching) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton key={index} className="h-56" />
        ))}
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-[var(--line)] bg-white/70 p-8 text-center text-sm text-[var(--ink-soft)]">
        No search results yet. Select bags, run indexing if needed, then search with a natural-language query.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {results.map((result) => (
        <ImageCard
          key={`${result.file_path}:${result.timestamp_ns}`}
          result={result}
          href={getResultHref?.(result)}
          onClick={onResultClick ? () => onResultClick(result) : undefined}
          onSimilarSearch={onSimilarSearch}
          onUseAsRegionSupport={onUseAsRegionSupport}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Verify lint + build**

Run: `cd frontend && npm run lint && npm run build`
Expected: clean. (Global search is unaffected — it passes neither `onUseAsRegionSupport`.)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/search/search-mode-toggle.tsx frontend/src/components/search/image-card.tsx frontend/src/components/search/results-grid.tsx
git commit -m "[UI] Search mode toggle + region promote action on result cards"
```

---

## Task 8: Frontend — RegionResultLightbox

**Files:**
- Create: `frontend/src/components/search/region-result-lightbox.tsx`

- [ ] **Step 1: Write the lightbox**

Create `frontend/src/components/search/region-result-lightbox.tsx`:

```tsx
import { ArrowLeft, ArrowRight, Crosshair, ExternalLink, Flame, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import type { HeatmapResponse, SearchResult } from "../../api/types";
import { AuthImage } from "../ui/auth-image";
import { Button } from "../ui/button";
import { HeatmapOverlay } from "./heatmap-overlay";

interface RegionResultLightboxProps {
  results: SearchResult[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  fetchHeatmap: (targetFilePath: string) => Promise<HeatmapResponse | null>;
  getResultHref: (result: SearchResult) => string;
  onUseAsRegionSupport: (result: SearchResult) => void;
}

export function RegionResultLightbox({
  results,
  index,
  onIndexChange,
  onClose,
  fetchHeatmap,
  getResultHref,
  onUseAsRegionSupport,
}: RegionResultLightboxProps) {
  const result = results[index];
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [opacity, setOpacity] = useState(0.6);
  const [heatmap, setHeatmap] = useState<HeatmapResponse | null>(null);
  const [loadingHeatmap, setLoadingHeatmap] = useState(false);

  // Reset heatmap when the focused result changes.
  useEffect(() => {
    setHeatmap(null);
    setShowHeatmap(false);
  }, [result?.file_path]);

  // Lazily fetch the heatmap when toggled on.
  useEffect(() => {
    if (!showHeatmap || heatmap || !result) return;
    let cancelled = false;
    setLoadingHeatmap(true);
    fetchHeatmap(result.file_path)
      .then((hm) => {
        if (!cancelled) setHeatmap(hm);
      })
      .finally(() => {
        if (!cancelled) setLoadingHeatmap(false);
      });
    return () => {
      cancelled = true;
    };
  }, [showHeatmap, heatmap, result, fetchHeatmap]);

  // Keyboard navigation.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft" && index > 0) onIndexChange(index - 1);
      if (e.key === "ArrowRight" && index < results.length - 1) onIndexChange(index + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, results.length, onClose, onIndexChange]);

  if (!result) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/85" role="dialog" aria-modal="true">
      <div className="flex items-center justify-between gap-3 px-4 py-3 text-white">
        <div className="min-w-0 text-sm">
          <span className="font-semibold">{result.source_bag}</span>
          <span className="ml-2 font-mono text-xs text-white/70">
            {(result.similarity_score * 100).toFixed(2)}% · {result.topic}
          </span>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 hover:bg-white/10">
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="flex flex-1 items-center justify-center px-4">
        <button
          type="button"
          onClick={() => index > 0 && onIndexChange(index - 1)}
          disabled={index === 0}
          aria-label="Previous result"
          className="mr-3 rounded-full p-2 text-white/80 hover:bg-white/10 disabled:opacity-30"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>

        <div className="relative inline-block">
          <AuthImage
            filePath={result.file_path}
            alt={`Region result from ${result.source_bag}`}
            className="block max-h-[72vh] max-w-full rounded-md"
          />
          {showHeatmap && heatmap ? (
            <HeatmapOverlay heatmap={heatmap} opacity={opacity} className="absolute inset-0 rounded-md" />
          ) : null}
        </div>

        <button
          type="button"
          onClick={() => index < results.length - 1 && onIndexChange(index + 1)}
          disabled={index >= results.length - 1}
          aria-label="Next result"
          className="ml-3 rounded-full p-2 text-white/80 hover:bg-white/10 disabled:opacity-30"
        >
          <ArrowRight className="h-5 w-5" />
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-4 px-4 py-3 text-white">
        <button
          type="button"
          onClick={() => setShowHeatmap((v) => !v)}
          className={
            "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs " +
            (showHeatmap ? "border-[var(--teal)] bg-[var(--teal)]/30" : "border-white/30 hover:bg-white/10")
          }
        >
          <Flame className="h-3.5 w-3.5" />
          {loadingHeatmap ? "Loading…" : "Heatmap"}
        </button>
        <label className="flex items-center gap-2 text-xs text-white/80">
          Opacity
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={opacity}
            onChange={(e) => setOpacity(Number(e.target.value))}
            disabled={!showHeatmap}
            className="accent-[var(--teal)]"
          />
        </label>
        <button
          type="button"
          onClick={() => onUseAsRegionSupport(result)}
          className="inline-flex items-center gap-1.5 rounded-full border border-white/30 px-3 py-1 text-xs hover:bg-white/10"
        >
          <Crosshair className="h-3.5 w-3.5" /> Use as region support
        </button>
        <Button asChild variant="secondary" size="sm">
          <Link to={getResultHref(result)}>
            <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> Open in Explorer
          </Link>
        </Button>
        <span className="text-xs text-white/60">{index + 1} / {results.length}</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify lint + build**

Run: `cd frontend && npm run lint && npm run build`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/search/region-result-lightbox.tsx
git commit -m "[UI] RegionResultLightbox with heatmap toggle + result stepping"
```

---

## Task 9: Frontend — wire Region mode into the search page

**Files:**
- Modify: `frontend/src/pages/search.tsx`

- [ ] **Step 1: Replace the search page with the mode-aware version**

Replace the entire contents of `frontend/src/pages/search.tsx` with:

```tsx
import { Crosshair, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import type { Point, SearchResult } from "../api/types";
import { ResultsGrid } from "../components/search/results-grid";
import { BagPickerChip } from "../components/search/bag-picker-chip";
import { FilterChip } from "../components/search/filter-chip";
import { RegionResultLightbox } from "../components/search/region-result-lightbox";
import { RegionSupportChip } from "../components/search/region-support-chip";
import { RegionSupportDialog, type RegionSupport } from "../components/search/region-support-dialog";
import { SearchInput } from "../components/search/search-input";
import { SearchModeToggle, type SearchMode } from "../components/search/search-mode-toggle";
import { Button } from "../components/ui/button";
import { useBags } from "../context/bags-context";
import { useRegionSearch } from "../hooks/use-region-search";
import { useUrlSearch } from "../hooks/use-url-search";
import { encodeBagId } from "../lib/bag-id";

const EXAMPLES = ["pedestrian on the crosswalk", "parked car", "traffic light"];

export function SearchPage() {
  const { bags } = useBags();
  const indexedCount = bags.filter((b) => b.is_indexed).length;
  const noBagsScanned = bags.length === 0;
  const allUnindexed = bags.length > 0 && indexedCount === 0;

  const [searchParams, setSearchParams] = useSearchParams();
  const mode: SearchMode = searchParams.get("mode") === "region" ? "region" : "global";

  const search = useUrlSearch();
  const region = useRegionSearch();

  const [globalDraft, setGlobalDraft] = useState(search.q);
  const [regionDraft, setRegionDraft] = useState("");

  // Region support being edited in the dialog.
  const [editingSupport, setEditingSupport] = useState<RegionSupport | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogInitialPoints, setDialogInitialPoints] = useState<Point[]>([]);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  // Keep the global draft in sync when the URL q changes externally.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setGlobalDraft(search.q);
  }, [search.q]);

  // In region mode, ensure no stale global query keeps fetching in the background.
  useEffect(() => {
    if (mode === "region" && (search.q !== "" || search.similar !== "")) search.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, search.q, search.similar]);

  const getResultHref = (result: SearchResult) =>
    `/bags/${encodeBagId(result.bag_path)}?t=${result.timestamp_ns}`;

  const handleSimilar = (result: SearchResult) => {
    search.submitSimilar(result.file_path);
  };

  const setMode = (next: SearchMode) => {
    const params = new URLSearchParams(searchParams);
    if (next === "region") params.set("mode", "region");
    else params.delete("mode");
    setSearchParams(params, { replace: false });
    if (next === "region") {
      setGlobalDraft("");
      search.clear();
    } else {
      region.clear();
      setRegionDraft("");
      setLightboxIndex(null);
    }
  };

  // --- Region handlers ---
  const handleRegionUpload = (file: File) => {
    const objectUrl = URL.createObjectURL(file);
    setEditingSupport({ kind: "image", file, objectUrl });
    setDialogInitialPoints([]);
    setDialogOpen(true);
  };

  const handleEditSupport = () => {
    if (!region.query || region.query.kind === "text") return;
    if (region.query.kind === "image") {
      setEditingSupport({ kind: "image", file: region.query.file, objectUrl: region.query.objectUrl });
    } else {
      setEditingSupport({ kind: "frame", filePath: region.query.filePath });
    }
    setDialogInitialPoints(region.query.points);
    setDialogOpen(true);
  };

  const handlePromote = (result: SearchResult) => {
    setLightboxIndex(null);
    setEditingSupport({ kind: "frame", filePath: result.file_path });
    setDialogInitialPoints([]);
    setDialogOpen(true);
  };

  const handleConfirmSupport = (points: Point[]) => {
    setDialogOpen(false);
    if (!editingSupport) return;
    if (editingSupport.kind === "image") {
      region.runImage(editingSupport.file, editingSupport.objectUrl, points, search.bagPaths, search.topK);
    } else {
      region.runFrame(editingSupport.filePath, points, search.bagPaths, search.topK);
    }
  };

  const openLightbox = (result: SearchResult) => {
    const filtered = region.results.filter((r) => r.similarity_score >= search.minScore);
    const i = filtered.findIndex(
      (r) => r.file_path === result.file_path && r.timestamp_ns === result.timestamp_ns,
    );
    if (i >= 0) setLightboxIndex(i);
  };

  // No bags scanned at all → hard block with CTA.
  if (noBagsScanned) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <Search className="mx-auto mb-3 h-8 w-8 text-[var(--ink-soft)]" />
        <h2 className="text-base font-semibold">No indexed bags yet</h2>
        <p className="mt-1 text-sm text-[var(--ink-soft)]">
          Scan a directory and index at least one bag before searching.
        </p>
        <Button asChild className="mt-4">
          <Link to="/bags">Go to Bag Explorer</Link>
        </Button>
      </div>
    );
  }

  const regionResults = region.results.filter((r) => r.similarity_score >= search.minScore);
  const hasGlobalQuery = search.q !== "" || search.similar !== "";
  const hasRegionQuery = region.query !== null;
  const hidden = search.rawResultCount - search.results.length;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <SearchModeToggle mode={mode} onChange={setMode} />
        <div className="flex-1">
          {mode === "global" ? (
            <SearchInput
              value={globalDraft}
              placeholder={`Search across ${indexedCount} indexed bag${indexedCount === 1 ? "" : "s"}`}
              onChange={setGlobalDraft}
              onSubmit={(text) => {
                if (allUnindexed) {
                  toast.error("Index at least one bag to search.");
                  return;
                }
                search.submitText(text);
              }}
              onClear={() => {
                setGlobalDraft("");
                search.clear();
              }}
              onImageUpload={(file) => void search.submitImage(file)}
            />
          ) : (
            <SearchInput
              value={regionDraft}
              placeholder="Describe a region, or upload / promote an image"
              onChange={setRegionDraft}
              onSubmit={(text) => {
                if (allUnindexed) {
                  toast.error("Index at least one bag to search.");
                  return;
                }
                region.runText(text, search.bagPaths, search.topK);
              }}
              onClear={() => setRegionDraft("")}
              onImageUpload={handleRegionUpload}
            />
          )}
        </div>
        <BagPickerChip selectedBagIds={search.urlBags} onChange={(ids) => search.setBags(ids)} />
      </div>

      {mode === "region" && region.query && region.query.kind !== "text" ? (
        <RegionSupportChip
          thumbnailUrl={region.query.kind === "image" ? region.query.objectUrl : null}
          pointCount={region.query.points.length}
          onEdit={handleEditSupport}
          onClear={() => region.clear()}
        />
      ) : null}

      {(mode === "global" && hasGlobalQuery) || (mode === "region" && hasRegionQuery) ? (
        <FilterChip
          topK={search.topK}
          minScore={search.minScore}
          rawResultCount={mode === "global" ? search.rawResultCount : region.results.length}
          bagCount={search.bagPaths.length || indexedCount}
          onTopKChange={search.setTopK}
          onMinScoreChange={search.setMinScore}
        />
      ) : null}

      {mode === "global" ? (
        !hasGlobalQuery ? (
          <EmptyState
            indexedCount={indexedCount}
            onPick={(text) => {
              setGlobalDraft(text);
              search.submitText(text);
            }}
          />
        ) : search.isSearching ? (
          <ResultsGrid results={[]} isSearching getResultHref={getResultHref} />
        ) : search.results.length === 0 && hidden > 0 ? (
          <ZeroAboveThreshold hidden={hidden} onLowerThreshold={() => search.setMinScore(0)} />
        ) : search.results.length === 0 ? (
          <p className="py-12 text-center text-sm text-[var(--ink-soft)]">No matches found.</p>
        ) : (
          <ResultsGrid
            results={search.results}
            isSearching={false}
            getResultHref={getResultHref}
            onSimilarSearch={handleSimilar}
          />
        )
      ) : region.unavailable ? (
        <p className="py-12 text-center text-sm text-[var(--ink-soft)]">
          Region search isn't available with the current backend. Re-index with a dense-capable embedder to enable it.
        </p>
      ) : !hasRegionQuery ? (
        <RegionEmptyState
          onPick={(text) => {
            setRegionDraft(text);
            region.runText(text, search.bagPaths, search.topK);
          }}
        />
      ) : region.isSearching ? (
        <ResultsGrid results={[]} isSearching />
      ) : regionResults.length === 0 ? (
        <p className="py-12 text-center text-sm text-[var(--ink-soft)]">No matching regions found.</p>
      ) : (
        <ResultsGrid
          results={regionResults}
          isSearching={false}
          onResultClick={openLightbox}
          onUseAsRegionSupport={handlePromote}
        />
      )}

      <RegionSupportDialog
        open={dialogOpen}
        support={editingSupport}
        initialPoints={dialogInitialPoints}
        onClose={() => setDialogOpen(false)}
        onConfirm={handleConfirmSupport}
      />

      {lightboxIndex !== null && regionResults[lightboxIndex] ? (
        <RegionResultLightbox
          results={regionResults}
          index={lightboxIndex}
          onIndexChange={setLightboxIndex}
          onClose={() => setLightboxIndex(null)}
          fetchHeatmap={region.fetchHeatmap}
          getResultHref={getResultHref}
          onUseAsRegionSupport={handlePromote}
        />
      ) : null}
    </div>
  );
}

function EmptyState({
  indexedCount,
  onPick,
}: {
  indexedCount: number;
  onPick: (text: string) => void;
}) {
  return (
    <div className="py-16 text-center">
      <Search className="mx-auto mb-3 h-8 w-8 text-[var(--ink-soft)]" />
      <h2 className="text-base font-semibold">
        Search across {indexedCount} indexed bag{indexedCount === 1 ? "" : "s"}
      </h2>
      <p className="mt-1 text-sm text-[var(--ink-soft)]">Try one of these examples:</p>
      <div className="mt-3 flex flex-wrap justify-center gap-2">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            onClick={() => onPick(ex)}
            className="rounded-full border border-[var(--line)] bg-[var(--bg-paper)] px-3 py-1 text-xs hover:bg-[var(--bg-sand)]"
          >
            {ex}
          </button>
        ))}
      </div>
    </div>
  );
}

function RegionEmptyState({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="py-16 text-center">
      <Crosshair className="mx-auto mb-3 h-8 w-8 text-[var(--ink-soft)]" />
      <h2 className="text-base font-semibold">Find a specific region</h2>
      <p className="mt-1 text-sm text-[var(--ink-soft)]">
        Describe it, or use the image button to upload / mark points on a support image.
      </p>
      <div className="mt-3 flex flex-wrap justify-center gap-2">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            onClick={() => onPick(ex)}
            className="rounded-full border border-[var(--line)] bg-[var(--bg-paper)] px-3 py-1 text-xs hover:bg-[var(--bg-sand)]"
          >
            {ex}
          </button>
        ))}
      </div>
    </div>
  );
}

function ZeroAboveThreshold({
  hidden,
  onLowerThreshold,
}: {
  hidden: number;
  onLowerThreshold: () => void;
}) {
  return (
    <div className="py-12 text-center text-sm">
      <p className="text-[var(--ink-soft)]">
        No matches above the current threshold ({hidden} hit{hidden === 1 ? "" : "s"} hidden).
      </p>
      <button
        type="button"
        onClick={onLowerThreshold}
        className="mt-2 text-[var(--teal)] hover:underline"
      >
        Lower the threshold
      </button>
    </div>
  );
}
```

Note: `dialogInitialPoints` is typed `Point[]` explicitly — a bare `useState([])` infers `never[]` and would reject `setDialogInitialPoints(region.query.points)`. The `Point` import is added to the `../api/types` import line.

- [ ] **Step 2: Verify lint + build**

Run: `cd frontend && npm run lint && npm run build`
Expected: clean. If ESLint flags `react-hooks/exhaustive-deps` anywhere beyond the two already-disabled lines, add a matching `// eslint-disable-next-line react-hooks/exhaustive-deps` rather than widening dependencies (matches the existing pattern in this file and `use-url-search.ts`).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/search.tsx
git commit -m "[UI] Wire Region mode into the search page (toggle, dialog, lightbox)"
```

- [ ] **Step 4: Manual end-to-end verification**

Prereq: a bag re-indexed with the dense-capable backend (existing bags are schema v3 and will be skipped — see spec). Then build + serve:

```bash
cd frontend && npm run build
cd .. && JWT_SECRET=dev REFRESH_SECRET=dev uv run uvicorn app:app --reload
```

Open http://localhost:8000/search, log in, and verify:
- Toggle to **Region**; URL gains `?mode=region` and survives refresh.
- Text query returns a ranked grid.
- Image button → dialog → click points → Done → results; support chip shows the count; editing it reopens the dialog with points preserved.
- Click a result → lightbox; toggle **Heatmap** (overlay appears, opacity slider works); ←/→ steps; **Open in Explorer** navigates to `/bags/...?t=`.
- "Use as region support" (card crosshair or lightbox) opens the dialog with that frame; Done runs a by-frame search excluding the support frame.
- With a non-dense backend, region queries show the "not available" message instead of crashing.

---

## Self-review (completed during authoring)

- **Spec coverage:** §1 decisions → Tasks 7,9 (toggle/placement), 4,6,8 (sources), 2 (heatmap route), 5,8 (presentation), 4,9 (state); §2 backend → Tasks 1–2; §3 components → Tasks 4–9 (every file mapped); §5 client → Task 3; §6 flows → Task 9 handlers + Task 8; §7 errors → Task 4 (`unavailable`), Task 6 (empty-points disabled "Done"), Task 9 (unavailable message, threshold reuse); §8 testing → Tasks 1,2 (pytest), every frontend task (lint+build), Task 9 step 4 (manual). No uncovered requirement.
- **Placeholders:** none — every step carries full code/commands.
- **Type consistency:** `RegionQuery` (text/image/frame) and `RegionSupport` (image/frame) used consistently; `useRegionSearch` returns `runText/runImage(file,objectUrl,points,bagPaths,topK)/runFrame(filePath,points,bagPaths,topK)/clear/fetchHeatmap/query/results/isSearching/unavailable` — matching every call site in Task 9; `HeatmapResponse {height,width,grid}` matches the backend dict (`region_search.py:169`) and the route stub; `ResultsGrid`/`ImageCard` `onUseAsRegionSupport(result)` signatures match; `SearchMode` `"global"|"region"` consistent.
```
