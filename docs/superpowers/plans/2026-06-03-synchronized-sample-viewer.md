# Synchronized Sample Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add synchronized multi-camera Sample inspection for `/bags` and `/search` while keeping Frame search results and `/api/bags/frames` stable.

**Architecture:** Backend Sample construction is a pure service over existing `metadata.json` flat per-camera Frames, exposed through a thin `/api/bags/samples` route. Frontend adds Sample API/types, a shared `SampleViewer`, frontend-only Camera layout persistence, a Sample browser hook for Bag Explorer time navigation, and a Search lightbox whose arrows move through ranked Frame results.

**Tech Stack:** Backend - FastAPI, Python dataclasses-free pure helpers, pytest + TestClient. Frontend - React 19, Vite, TailwindCSS, React Router, lucide-react, existing shadcn-style UI components. Frontend verification is `rtk npm run lint` and `rtk npm run build` from `frontend/`.

**Spec:** `docs/superpowers/specs/2026-06-03-sample-viewer-design.md`

**Current repo state:** Multi-camera ingestion is already present: `metadata.json` schema version 5 has top-level `cameras[]`, flat `frames[]`, per-frame `topic`, and per-frame optional `lat`/`lon`. Do not plan ingestion changes. `/workspace` is deprecated and intentionally unchanged except where shared optional props keep existing imports compiling.

---

## File Structure

**Backend create:**
- `src/services/sample_service.py` - Sample grouping rules, Camera list extraction, tolerance calculation, focus Frame path resolution.
- `tests/test_bags_samples.py` - route-level coverage for `/api/bags/samples`.

**Backend modify:**
- `src/api/bags.py` - add `/samples` endpoint that validates bag path and delegates to `sample_service`.

**Frontend create:**
- `frontend/src/lib/sample-camera-layout.ts` - default layouts, localStorage keying, validation, read/write/reset helpers.
- `frontend/src/components/samples/sample-viewer.tsx` - shared dynamic Camera tile viewer, placeholders, focus highlight, layout editor, optional heatmap overlays.
- `frontend/src/hooks/use-sample-browser.ts` - Bag Explorer Sample browsing state, paging, keyboard target selection, chat window state.
- `frontend/src/components/bags/bag-sample-browser.tsx` - Bag Explorer shell with header slot, Sample viewer, anchor-thumbnail strip, chat panel.
- `frontend/src/components/search/sample-result-lightbox.tsx` - Global/Region Search Sample lightbox, ranked-result navigation, optional per-tile heatmaps.

**Frontend modify:**
- `frontend/src/api/types.ts` - add `SampleFrameInfo`, `SampleInfo`, `SamplesResponse`.
- `frontend/src/api/client.ts` - add `getSamples(...)`.
- `frontend/src/components/search/image-card.tsx` - add explicit Explorer action separate from normal card click.
- `frontend/src/components/search/results-grid.tsx` - forward `explorerHref` and allow normal clicks for Global results.
- `frontend/src/pages/bags/bag-detail-page.tsx` - switch from frame sequence hook/component to Sample browser hook/component.
- `frontend/src/pages/search.tsx` - use Sample lightbox for Global and Region results; remove Region-only lightbox usage.

---

## Task 1: Backend Sample Service and API

**Files:**
- Create: `src/services/sample_service.py`
- Modify: `src/api/bags.py`
- Test: `tests/test_bags_samples.py`

- [ ] **Step 1: Write failing API tests**

Create `tests/test_bags_samples.py`:

```python
import json

from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.api.bags import router as bags_router
from src.core.storage import resolve_artifact_path


def _client(bypass_auth):
    app = FastAPI()
    app.include_router(bags_router)
    bypass_auth(app)
    return TestClient(app)


def _write_bag(tmp_path, metadata):
    bag = tmp_path / "bag"
    bag.mkdir()
    (bag / "sample.mcap").write_bytes(b"")
    artifact = resolve_artifact_path(bag_path=bag)
    artifact.mkdir(parents=True, exist_ok=True)
    for frame in metadata["frames"]:
        path = artifact / frame["file_path"]
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"jpg")
    (artifact / "metadata.json").write_text(json.dumps(metadata), encoding="utf-8")
    return bag, artifact


def test_samples_use_metadata_cameras_order_and_anchor_timeline(tmp_path, bypass_auth):
    metadata = {
        "schema_version": 5,
        "cameras": ["/cam/front", "/cam/left", "/cam/right"],
        "frames": [
            {"timestamp_ns": 1_000_000_000, "topic": "/cam/front", "file_path": "thumbnails/front/frame_1000000000.jpg"},
            {"timestamp_ns": 1_050_000_000, "topic": "/cam/left", "file_path": "thumbnails/left/frame_1050000000.jpg"},
            {"timestamp_ns": 1_500_000_001, "topic": "/cam/right", "file_path": "thumbnails/right/frame_1500000001.jpg"},
            {"timestamp_ns": 2_000_000_000, "topic": "/cam/front", "file_path": "thumbnails/front/frame_2000000000.jpg"},
            {"timestamp_ns": 2_060_000_000, "topic": "/cam/left", "file_path": "thumbnails/left/frame_2060000000.jpg"},
            {"timestamp_ns": 2_100_000_000, "topic": "/cam/right", "file_path": "thumbnails/right/frame_2100000000.jpg"},
        ],
    }
    bag, artifact = _write_bag(tmp_path, metadata)

    resp = _client(bypass_auth).get(
        "/api/bags/samples",
        params={"bag_path": str(bag), "start_ns": 0, "duration_sec": 3},
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["cameras"] == ["/cam/front", "/cam/left", "/cam/right"]
    assert body["anchor_camera"] == "/cam/front"
    assert body["sample_tolerance_ns"] == 500_000_000
    assert [s["timestamp_ns"] for s in body["samples"]] == [1_000_000_000, 2_000_000_000]
    first = body["samples"][0]
    assert first["anchor_frame"]["topic"] == "/cam/front"
    assert set(first["frames_by_camera"]) == {"/cam/front", "/cam/left"}
    assert first["frames_by_camera"]["/cam/left"]["delta_ns"] == 50_000_000
    assert first["frames_by_camera"]["/cam/front"]["file_path"] == str(
        artifact / "thumbnails/front/frame_1000000000.jpg"
    )


def test_samples_fallback_cameras_first_seen_and_missing_anchorless_camera(tmp_path, bypass_auth):
    metadata = {
        "schema_version": 5,
        "frames": [
            {"timestamp_ns": 10_000_000_000, "topic": "/cam/b", "file_path": "thumbnails/b/frame_10.jpg"},
            {"timestamp_ns": 10_200_000_000, "topic": "/cam/a", "file_path": "thumbnails/a/frame_10.jpg"},
            {"timestamp_ns": 11_000_000_000, "topic": "/cam/b", "file_path": "thumbnails/b/frame_11.jpg"},
            {"timestamp_ns": 11_800_000_001, "topic": "/cam/a", "file_path": "thumbnails/a/frame_11.jpg"},
        ],
    }
    bag, _artifact = _write_bag(tmp_path, metadata)

    resp = _client(bypass_auth).get(
        "/api/bags/samples",
        params={"bag_path": str(bag), "start_ns": 10_000_000_000, "duration_sec": 2},
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["cameras"] == ["/cam/b", "/cam/a"]
    assert body["anchor_camera"] == "/cam/b"
    assert set(body["samples"][1]["frames_by_camera"]) == {"/cam/b"}


def test_samples_focus_path_forces_exact_frame_and_marks_focus(tmp_path, bypass_auth):
    metadata = {
        "schema_version": 5,
        "cameras": ["/cam/front"],
        "frames": [
            {"timestamp_ns": 1_000_000_000, "topic": "/cam/front", "file_path": "thumbnails/front/frame_a.jpg"},
            {"timestamp_ns": 1_000_000_000, "topic": "/cam/front", "file_path": "thumbnails/front/frame_b.jpg"},
        ],
    }
    bag, artifact = _write_bag(tmp_path, metadata)
    focus_abs = artifact / "thumbnails/front/frame_b.jpg"

    resp = _client(bypass_auth).get(
        "/api/bags/samples",
        params={
            "bag_path": str(bag),
            "start_ns": 0,
            "duration_sec": 1,
            "focus_file_path": str(focus_abs),
        },
    )

    assert resp.status_code == 200
    sample = resp.json()["samples"][0]
    frame = sample["frames_by_camera"]["/cam/front"]
    assert frame["file_path"] == str(focus_abs)
    assert frame["is_focus"] is True


def test_samples_focus_path_accepts_artifact_relative_path(tmp_path, bypass_auth):
    metadata = {
        "schema_version": 5,
        "cameras": ["/cam/front"],
        "frames": [
            {"timestamp_ns": 1, "topic": "/cam/front", "file_path": "thumbnails/front/frame_1.jpg"},
        ],
    }
    bag, _artifact = _write_bag(tmp_path, metadata)

    resp = _client(bypass_auth).get(
        "/api/bags/samples",
        params={
            "bag_path": str(bag),
            "start_ns": 0,
            "duration_sec": 1,
            "focus_file_path": "thumbnails/front/frame_1.jpg",
        },
    )

    assert resp.status_code == 200
    assert resp.json()["samples"][0]["frames_by_camera"]["/cam/front"]["is_focus"] is True


def test_samples_focus_path_not_found_returns_404(tmp_path, bypass_auth):
    metadata = {
        "schema_version": 5,
        "cameras": ["/cam/front"],
        "frames": [
            {"timestamp_ns": 1, "topic": "/cam/front", "file_path": "thumbnails/front/frame_1.jpg"},
        ],
    }
    bag, _artifact = _write_bag(tmp_path, metadata)

    resp = _client(bypass_auth).get(
        "/api/bags/samples",
        params={
            "bag_path": str(bag),
            "start_ns": 0,
            "duration_sec": 1,
            "focus_file_path": "thumbnails/front/missing.jpg",
        },
    )

    assert resp.status_code == 404
    assert "focus_file_path" in resp.json()["detail"]
```

- [ ] **Step 2: Run the tests to verify failure**

Run: `rtk uv run pytest tests/test_bags_samples.py -v`

Expected: tests fail with `404 Not Found` for `/api/bags/samples`.

- [ ] **Step 3: Add the Sample service**

Create `src/services/sample_service.py`:

```python
from __future__ import annotations

from pathlib import Path
from typing import Any


NANOSECONDS_PER_SECOND = 1_000_000_000


class FocusFrameNotFound(ValueError):
    """Raised when focus_file_path does not identify a frame in metadata.json."""


def sample_tolerance_ns(sampling_fps: float) -> int:
    if sampling_fps <= 0:
        raise ValueError("sampling_fps must be positive.")
    return int((0.5 / sampling_fps) * NANOSECONDS_PER_SECOND)


def camera_list(metadata: dict[str, Any]) -> list[str]:
    cameras = metadata.get("cameras")
    if isinstance(cameras, list) and cameras:
        return [str(camera) for camera in cameras]

    seen: list[str] = []
    for frame in metadata.get("frames", []):
        topic = frame.get("topic")
        if topic is None:
            continue
        topic_str = str(topic)
        if topic_str not in seen:
            seen.append(topic_str)
    return seen


def _absolute_frame_path(artifact_dir: Path, frame: dict[str, Any]) -> Path:
    raw = Path(str(frame["file_path"])).expanduser()
    return raw.resolve() if raw.is_absolute() else (artifact_dir / raw).resolve()


def _frame_info(
    artifact_dir: Path,
    frame: dict[str, Any],
    sample_timestamp_ns: int,
    *,
    is_focus: bool = False,
) -> dict[str, Any]:
    info: dict[str, Any] = {
        "timestamp_ns": int(frame["timestamp_ns"]),
        "topic": str(frame["topic"]),
        "file_path": str(_absolute_frame_path(artifact_dir, frame)),
        "delta_ns": int(frame["timestamp_ns"]) - sample_timestamp_ns,
    }
    if is_focus:
        info["is_focus"] = True
    return info


def _frames_by_camera(metadata: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for frame in metadata.get("frames", []):
        if "timestamp_ns" not in frame or "topic" not in frame or "file_path" not in frame:
            continue
        grouped.setdefault(str(frame["topic"]), []).append(frame)
    for frames in grouped.values():
        frames.sort(key=lambda item: int(item["timestamp_ns"]))
    return grouped


def _nearest_frame(frames: list[dict[str, Any]], timestamp_ns: int) -> dict[str, Any] | None:
    if not frames:
        return None
    return min(frames, key=lambda item: abs(int(item["timestamp_ns"]) - timestamp_ns))


def _find_focus_frame(
    artifact_dir: Path,
    metadata: dict[str, Any],
    focus_file_path: str,
) -> dict[str, Any]:
    raw_focus = Path(focus_file_path).expanduser()
    focus_abs = raw_focus.resolve() if raw_focus.is_absolute() else (artifact_dir / raw_focus).resolve()
    for frame in metadata.get("frames", []):
        if "file_path" not in frame:
            continue
        if _absolute_frame_path(artifact_dir, frame) == focus_abs:
            return frame
    raise FocusFrameNotFound(f"focus_file_path was not found in bag metadata: {focus_file_path}")


def _build_sample(
    *,
    artifact_dir: Path,
    cameras: list[str],
    grouped: dict[str, list[dict[str, Any]]],
    timestamp_ns: int,
    tolerance_ns: int,
    anchor_camera: str | None,
    focus_frame: dict[str, Any] | None = None,
) -> dict[str, Any]:
    frames_by_camera: dict[str, dict[str, Any]] = {}
    focus_topic = str(focus_frame["topic"]) if focus_frame is not None else None

    for camera in cameras:
        if focus_frame is not None and camera == focus_topic:
            frames_by_camera[camera] = _frame_info(
                artifact_dir, focus_frame, timestamp_ns, is_focus=True
            )
            continue
        nearest = _nearest_frame(grouped.get(camera, []), timestamp_ns)
        if nearest is None:
            continue
        delta_ns = int(nearest["timestamp_ns"]) - timestamp_ns
        if abs(delta_ns) <= tolerance_ns:
            frames_by_camera[camera] = _frame_info(artifact_dir, nearest, timestamp_ns)

    return {
        "timestamp_ns": timestamp_ns,
        "anchor_frame": frames_by_camera.get(anchor_camera) if anchor_camera else None,
        "frames_by_camera": frames_by_camera,
    }


def build_samples_response(
    *,
    bag_path: Path,
    artifact_dir: Path,
    metadata: dict[str, Any],
    start_ns: int,
    duration_sec: float,
    sampling_fps: float,
    focus_file_path: str | None = None,
) -> dict[str, Any]:
    cameras = camera_list(metadata)
    anchor_camera = cameras[0] if cameras else None
    tolerance_ns = sample_tolerance_ns(sampling_fps)
    grouped = _frames_by_camera(metadata)

    samples: list[dict[str, Any]] = []
    if focus_file_path:
        focus = _find_focus_frame(artifact_dir, metadata, focus_file_path)
        focus_timestamp_ns = int(focus["timestamp_ns"])
        samples.append(
            _build_sample(
                artifact_dir=artifact_dir,
                cameras=cameras,
                grouped=grouped,
                timestamp_ns=focus_timestamp_ns,
                tolerance_ns=tolerance_ns,
                anchor_camera=anchor_camera,
                focus_frame=focus,
            )
        )
    elif anchor_camera:
        end_ns = start_ns + int(duration_sec * NANOSECONDS_PER_SECOND)
        for anchor_frame in grouped.get(anchor_camera, []):
            timestamp_ns = int(anchor_frame["timestamp_ns"])
            if start_ns <= timestamp_ns <= end_ns:
                samples.append(
                    _build_sample(
                        artifact_dir=artifact_dir,
                        cameras=cameras,
                        grouped=grouped,
                        timestamp_ns=timestamp_ns,
                        tolerance_ns=tolerance_ns,
                        anchor_camera=anchor_camera,
                    )
                )

    return {
        "bag_path": str(bag_path),
        "cameras": cameras,
        "anchor_camera": anchor_camera,
        "sample_tolerance_ns": tolerance_ns,
        "samples": samples,
    }
```

- [ ] **Step 4: Add the route**

Modify `src/api/bags.py` imports:

```python
from src.services.sample_service import FocusFrameNotFound, build_samples_response
```

Add this endpoint after `bag_frames`:

```python
@router.get("/samples")
async def bag_samples(
    bag_path: str = Query(..., description="Absolute path of bag directory"),
    start_ns: int = Query(..., ge=0, description="Start timestamp in nanoseconds"),
    duration_sec: float = Query(
        10.0, ge=0.1, le=300.0, description="Window size in seconds"
    ),
    focus_file_path: str | None = Query(
        None,
        description="Absolute or artifact-relative frame path to force as the focused Sample Frame",
    ),
):
    path = Path(bag_path).expanduser().resolve()
    if not path.exists() or not path.is_dir():
        raise HTTPException(status_code=404, detail="Bag path does not exist")

    artifact_dir = _artifact_dir_for_bag(path)
    metadata_path = artifact_dir / "metadata.json"
    if not metadata_path.exists() or not metadata_path.is_file():
        raise HTTPException(
            status_code=404, detail="Bag metadata not found. Index the bag first."
        )

    with metadata_path.open("r", encoding="utf-8") as metadata_handle:
        metadata = json.load(metadata_handle)

    try:
        return build_samples_response(
            bag_path=path,
            artifact_dir=artifact_dir,
            metadata=metadata,
            start_ns=start_ns,
            duration_sec=duration_sec,
            sampling_fps=get_app_config().ingestion.sampling_fps,
            focus_file_path=focus_file_path,
        )
    except FocusFrameNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
```

- [ ] **Step 5: Run focused backend tests**

Run: `rtk uv run pytest tests/test_bags_samples.py -v`

Expected: 5 passed.

- [ ] **Step 6: Run existing backend contract tests**

Run: `rtk uv run pytest tests/test_bags_track.py tests/test_api_contracts.py -v`

Expected: pass; `/api/bags/frames` remains unchanged.

- [ ] **Step 7: Commit**

```bash
rtk git add src/services/sample_service.py src/api/bags.py tests/test_bags_samples.py
rtk git commit -m "[Backend] Add synchronized bag Sample API"
```

---

## Task 2: Frontend Sample Types, Client, and Layout Utilities

**Files:**
- Modify: `frontend/src/api/types.ts`
- Modify: `frontend/src/api/client.ts`
- Create: `frontend/src/lib/sample-camera-layout.ts`

- [ ] **Step 1: Add Sample response types**

In `frontend/src/api/types.ts`, add after `FramesResponse`:

```ts
export interface SampleFrameInfo {
  timestamp_ns: number;
  topic: string;
  file_path: string;
  delta_ns: number;
  is_focus?: boolean;
}

export interface SampleInfo {
  timestamp_ns: number;
  anchor_frame: SampleFrameInfo | null;
  frames_by_camera: Record<string, SampleFrameInfo>;
}

export interface SamplesResponse {
  bag_path: string;
  cameras: string[];
  anchor_camera: string | null;
  sample_tolerance_ns: number;
  samples: SampleInfo[];
}
```

- [ ] **Step 2: Add `getSamples` client helper**

In `frontend/src/api/client.ts`, add `SamplesResponse` to the type import list:

```ts
  SamplesResponse,
```

Add after `getFrames`:

```ts
export async function getSamples(
  bagPath: string,
  startNs: number,
  durationSec: number,
  focusFilePath?: string,
): Promise<SamplesResponse> {
  const params = new URLSearchParams({
    bag_path: bagPath,
    start_ns: String(startNs),
    duration_sec: String(durationSec),
  });
  if (focusFilePath) params.set("focus_file_path", focusFilePath);
  return http<SamplesResponse>(`/api/bags/samples?${params.toString()}`);
}
```

- [ ] **Step 3: Add Camera layout utilities**

Create `frontend/src/lib/sample-camera-layout.ts`:

```ts
export interface CameraSlot {
  row: number;
  col: number;
}

export interface CameraLayout {
  version: 1;
  cameras: string[];
  slots: Record<string, CameraSlot>;
}

export interface GridDimensions {
  rows: number;
  cols: number;
}

export function cameraLayoutStorageKey(cameras: string[]): string {
  const stable = [...cameras].sort().map((camera) => encodeURIComponent(camera)).join("|");
  return `sample-camera-layout:${stable}`;
}

export function defaultGridDimensions(count: number): GridDimensions {
  if (count <= 1) return { rows: 1, cols: 1 };
  if (count === 2) return { rows: 1, cols: 2 };
  if (count === 3) return { rows: 1, cols: 3 };
  if (count === 4) return { rows: 2, cols: 2 };
  if (count <= 6) return { rows: 2, cols: 3 };
  return { rows: Math.ceil(count / 3), cols: 3 };
}

export function defaultCameraLayout(cameras: string[]): CameraLayout {
  const { cols } = defaultGridDimensions(cameras.length);
  const slots: Record<string, CameraSlot> = {};
  cameras.forEach((camera, index) => {
    slots[camera] = { row: Math.floor(index / cols), col: index % cols };
  });
  return { version: 1, cameras: [...cameras], slots };
}

export function layoutDimensions(layout: CameraLayout): GridDimensions {
  const slots = Object.values(layout.slots);
  if (slots.length === 0) return { rows: 1, cols: 1 };
  return {
    rows: Math.max(...slots.map((slot) => slot.row)) + 1,
    cols: Math.max(...slots.map((slot) => slot.col)) + 1,
  };
}

export function layoutMatches(layout: CameraLayout, cameras: string[]): boolean {
  const expected = [...cameras].sort();
  const actual = [...layout.cameras].sort();
  if (expected.length !== actual.length) return false;
  return expected.every((camera, index) => camera === actual[index])
    && expected.every((camera) => layout.slots[camera] !== undefined);
}

export function readCameraLayout(cameras: string[]): CameraLayout {
  if (typeof window === "undefined") return defaultCameraLayout(cameras);
  const raw = window.localStorage.getItem(cameraLayoutStorageKey(cameras));
  if (!raw) return defaultCameraLayout(cameras);
  try {
    const parsed = JSON.parse(raw) as CameraLayout;
    if (parsed.version === 1 && layoutMatches(parsed, cameras)) return parsed;
  } catch {
    return defaultCameraLayout(cameras);
  }
  return defaultCameraLayout(cameras);
}

export function saveCameraLayout(layout: CameraLayout): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(cameraLayoutStorageKey(layout.cameras), JSON.stringify(layout));
}

export function clearCameraLayout(cameras: string[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(cameraLayoutStorageKey(cameras));
}

export function swapCameraSlots(
  layout: CameraLayout,
  camera: string,
  direction: "up" | "down" | "left" | "right",
): CameraLayout {
  const current = layout.slots[camera];
  if (!current) return layout;
  const delta = {
    up: { row: -1, col: 0 },
    down: { row: 1, col: 0 },
    left: { row: 0, col: -1 },
    right: { row: 0, col: 1 },
  }[direction];
  const next = { row: current.row + delta.row, col: current.col + delta.col };
  const { rows, cols } = layoutDimensions(layout);
  if (next.row < 0 || next.col < 0 || next.row >= rows || next.col >= cols) return layout;
  const other = layout.cameras.find((name) => {
    const slot = layout.slots[name];
    return slot.row === next.row && slot.col === next.col;
  });
  const slots = { ...layout.slots, [camera]: next };
  if (other) slots[other] = current;
  return { ...layout, slots };
}
```

- [ ] **Step 4: Verify TypeScript compilation catches no type errors**

Run from `frontend/`: `rtk npm run build`

Expected: TypeScript build and Vite build pass.

- [ ] **Step 5: Commit**

```bash
rtk git add frontend/src/api/types.ts frontend/src/api/client.ts frontend/src/lib/sample-camera-layout.ts
rtk git commit -m "[Frontend] Add Sample API types and Camera layout utilities"
```

---

## Task 3: Shared Sample Viewer Component

**Files:**
- Create: `frontend/src/components/samples/sample-viewer.tsx`

- [ ] **Step 1: Create shared viewer**

Create `frontend/src/components/samples/sample-viewer.tsx`:

```tsx
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  LoaderCircle,
  RotateCcw,
  Save,
  Settings2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { HeatmapResponse, SampleInfo } from "../../api/types";
import {
  clearCameraLayout,
  defaultCameraLayout,
  layoutDimensions,
  readCameraLayout,
  saveCameraLayout,
  swapCameraSlots,
  type CameraLayout,
} from "../../lib/sample-camera-layout";
import { cn } from "../../lib/utils";
import { AuthImage } from "../ui/auth-image";
import { Button } from "../ui/button";
import { HeatmapOverlay } from "../search/heatmap-overlay";

interface SampleViewerProps {
  cameras: string[];
  sample: SampleInfo | null;
  isLoading?: boolean;
  heatmaps?: Record<string, HeatmapResponse | undefined>;
  heatmapLoading?: Record<string, boolean | undefined>;
  showHeatmaps?: boolean;
  heatmapOpacity?: number;
  className?: string;
}

function shortCameraName(topic: string): string {
  const parts = topic.split("/").filter(Boolean);
  return parts.slice(-2).join("/") || topic;
}

export function SampleViewer({
  cameras,
  sample,
  isLoading = false,
  heatmaps = {},
  heatmapLoading = {},
  showHeatmaps = false,
  heatmapOpacity = 0.6,
  className,
}: SampleViewerProps) {
  const [editMode, setEditMode] = useState(false);
  const [layout, setLayout] = useState<CameraLayout>(() => readCameraLayout(cameras));

  useEffect(() => {
    setLayout(readCameraLayout(cameras));
    setEditMode(false);
  }, [cameras]);

  const dimensions = useMemo(() => layoutDimensions(layout), [layout]);
  const cameraBySlot = useMemo(() => {
    const map = new Map<string, string>();
    for (const camera of layout.cameras) {
      const slot = layout.slots[camera];
      if (slot) map.set(`${slot.row}:${slot.col}`, camera);
    }
    return map;
  }, [layout]);

  const cells = [];
  for (let row = 0; row < dimensions.rows; row += 1) {
    for (let col = 0; col < dimensions.cols; col += 1) {
      cells.push({ row, col, camera: cameraBySlot.get(`${row}:${col}`) ?? null });
    }
  }

  const moveCamera = (camera: string, direction: "up" | "down" | "left" | "right") => {
    setLayout((current) => swapCameraSlots(current, camera, direction));
  };

  const saveLayout = () => {
    saveCameraLayout(layout);
    setEditMode(false);
  };

  const resetLayout = () => {
    clearCameraLayout(cameras);
    setLayout(defaultCameraLayout(cameras));
  };

  if (isLoading) {
    return (
      <div className={cn("flex min-h-[320px] items-center justify-center bg-black", className)}>
        <LoaderCircle className="h-8 w-8 animate-spin text-white/70" />
      </div>
    );
  }

  if (!sample || cameras.length === 0) {
    return (
      <div className={cn("flex min-h-[320px] items-center justify-center bg-black text-sm text-white/70", className)}>
        No sample available.
      </div>
    );
  }

  return (
    <div className={cn("relative flex min-h-0 flex-1 flex-col bg-black", className)}>
      <div className="absolute right-3 top-3 z-20 flex gap-1">
        {editMode ? (
          <>
            <Button type="button" size="icon" variant="secondary" onClick={saveLayout} title="Save Camera layout" aria-label="Save Camera layout">
              <Save className="h-4 w-4" />
            </Button>
            <Button type="button" size="icon" variant="secondary" onClick={resetLayout} title="Reset Camera layout" aria-label="Reset Camera layout">
              <RotateCcw className="h-4 w-4" />
            </Button>
          </>
        ) : null}
        <Button type="button" size="icon" variant="secondary" onClick={() => setEditMode((v) => !v)} title="Edit Camera layout" aria-label="Edit Camera layout">
          <Settings2 className="h-4 w-4" />
        </Button>
      </div>

      <div
        className="grid min-h-0 flex-1 gap-1 p-1"
        style={{
          gridTemplateRows: `repeat(${dimensions.rows}, minmax(0, 1fr))`,
          gridTemplateColumns: `repeat(${dimensions.cols}, minmax(0, 1fr))`,
        }}
      >
        {cells.map(({ row, col, camera }) => {
          const frame = camera ? sample.frames_by_camera[camera] : undefined;
          const heatmap = frame ? heatmaps[frame.file_path] : undefined;
          const loadingHeatmap = frame ? heatmapLoading[frame.file_path] : false;
          return (
            <div key={`${row}:${col}`} className="relative min-h-0 overflow-hidden bg-black">
              {camera && frame ? (
                <div className={cn("relative h-full w-full", frame.is_focus ? "ring-2 ring-[var(--teal)] ring-inset" : "")}>
                  <AuthImage
                    filePath={frame.file_path}
                    alt={shortCameraName(camera)}
                    className="h-full w-full object-contain"
                  />
                  {showHeatmaps && heatmap ? (
                    <HeatmapOverlay heatmap={heatmap} opacity={heatmapOpacity} className="absolute inset-0" />
                  ) : null}
                  {showHeatmaps && loadingHeatmap ? (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/25">
                      <LoaderCircle className="h-5 w-5 animate-spin text-white/80" />
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-black text-xs text-white/40">
                  {editMode && camera ? shortCameraName(camera) : ""}
                </div>
              )}

              {editMode && camera ? (
                <div className="absolute inset-x-2 top-2 z-10 rounded bg-black/70 p-2 text-white">
                  <div className="truncate text-xs font-semibold" title={camera}>{shortCameraName(camera)}</div>
                  <div className="mt-2 flex gap-1">
                    <Button type="button" size="icon" variant="secondary" className="h-7 w-7" onClick={() => moveCamera(camera, "left")} title="Move left" aria-label="Move left">
                      <ArrowLeft className="h-3.5 w-3.5" />
                    </Button>
                    <Button type="button" size="icon" variant="secondary" className="h-7 w-7" onClick={() => moveCamera(camera, "right")} title="Move right" aria-label="Move right">
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Button>
                    <Button type="button" size="icon" variant="secondary" className="h-7 w-7" onClick={() => moveCamera(camera, "up")} title="Move up" aria-label="Move up">
                      <ArrowUp className="h-3.5 w-3.5" />
                    </Button>
                    <Button type="button" size="icon" variant="secondary" className="h-7 w-7" onClick={() => moveCamera(camera, "down")} title="Move down" aria-label="Move down">
                      <ArrowDown className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify frontend build**

Run from `frontend/`: `rtk npm run build`

Expected: build passes with the new component unused.

- [ ] **Step 3: Commit**

```bash
rtk git add frontend/src/components/samples/sample-viewer.tsx
rtk git commit -m "[UI] Add shared synchronized Sample viewer"
```

---

## Task 4: Bag Explorer Sample Browser Hook

**Files:**
- Create: `frontend/src/hooks/use-sample-browser.ts`

- [ ] **Step 1: Create Sample browsing hook**

Create `frontend/src/hooks/use-sample-browser.ts`:

```ts
import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { chatWithClip, getSamples } from "../api/client";
import type { SampleInfo, SamplesResponse, SearchResult } from "../api/types";

const DEFAULT_WINDOW_SECONDS = 10;
const HALF_WINDOW_NS = (DEFAULT_WINDOW_SECONDS / 2) * 1_000_000_000;
const PAGED_LOAD_SECONDS = 20;

function mergeSamples(existing: SampleInfo[], incoming: SampleInfo[]): SampleInfo[] {
  const byTimestamp = new Map<number, SampleInfo>();
  for (const sample of existing) byTimestamp.set(sample.timestamp_ns, sample);
  for (const sample of incoming) byTimestamp.set(sample.timestamp_ns, sample);
  return Array.from(byTimestamp.values()).sort((a, b) => a.timestamp_ns - b.timestamp_ns);
}

function nearestSampleTimestamp(samples: SampleInfo[], targetNs: number): number | null {
  if (samples.length === 0) return null;
  let best = samples[0].timestamp_ns;
  let bestDiff = Math.abs(best - targetNs);
  for (const sample of samples) {
    const diff = Math.abs(sample.timestamp_ns - targetNs);
    if (diff < bestDiff) {
      best = sample.timestamp_ns;
      bestDiff = diff;
    }
  }
  return best;
}

function computeClipWindow(
  centerNs: number,
  durationSec: number,
  minNs: number,
  maxNs: number,
): { startNs: number; endNs: number } {
  if (maxNs <= minNs) return { startNs: minNs, endNs: maxNs };
  const durationNs = Math.max(1, Math.floor(durationSec * 1_000_000_000));
  const halfDurationNs = Math.floor(durationNs / 2);
  let startNs = centerNs - halfDurationNs;
  let endNs = startNs + durationNs;
  if (startNs < minNs) {
    startNs = minNs;
    endNs = startNs + durationNs;
  }
  if (endNs > maxNs) {
    endNs = maxNs;
    startNs = Math.max(minNs, endNs - durationNs);
  }
  return { startNs: Math.max(minNs, startNs), endNs: Math.min(maxNs, endNs) };
}

export function useSampleBrowser() {
  const requestIdRef = useRef(0);
  const [selectedResult, setSelectedResult] = useState<SearchResult | null>(null);
  const [samples, setSamples] = useState<SampleInfo[]>([]);
  const [cameras, setCameras] = useState<string[]>([]);
  const [anchorCamera, setAnchorCamera] = useState<string | null>(null);
  const [sampleToleranceNs, setSampleToleranceNs] = useState<number | null>(null);
  const [selectedTimestampNs, setSelectedTimestampNs] = useState<number | null>(null);
  const [isLoadingSamples, setIsLoadingSamples] = useState(false);
  const [isExtendingLeft, setIsExtendingLeft] = useState(false);
  const [isExtendingRight, setIsExtendingRight] = useState(false);
  const [canLoadMoreLeft, setCanLoadMoreLeft] = useState(true);
  const [canLoadMoreRight, setCanLoadMoreRight] = useState(true);
  const [loadedRangeStartNs, setLoadedRangeStartNs] = useState<number | null>(null);
  const [loadedRangeEndNs, setLoadedRangeEndNs] = useState<number | null>(null);
  const [chatQuery, setChatQuery] = useState("");
  const [chatDuration, setChatDuration] = useState(DEFAULT_WINDOW_SECONDS);
  const [chatResponse, setChatResponse] = useState<string | null>(null);
  const [isChatting, setIsChatting] = useState(false);

  const selectedSampleIndex = useMemo(() => {
    if (selectedTimestampNs === null) return -1;
    return samples.findIndex((sample) => sample.timestamp_ns === selectedTimestampNs);
  }, [samples, selectedTimestampNs]);

  const activeSample = useMemo(() => {
    if (selectedTimestampNs === null) return null;
    return samples.find((sample) => sample.timestamp_ns === selectedTimestampNs) ?? null;
  }, [samples, selectedTimestampNs]);

  const frameRange = useMemo(() => {
    if (samples.length === 0) {
      const fallback = selectedTimestampNs ?? selectedResult?.timestamp_ns ?? null;
      return fallback === null ? null : { minNs: fallback, maxNs: fallback };
    }
    return { minNs: samples[0].timestamp_ns, maxNs: samples[samples.length - 1].timestamp_ns };
  }, [samples, selectedResult?.timestamp_ns, selectedTimestampNs]);

  const vlmWindow = useMemo(() => {
    if (selectedTimestampNs === null || !frameRange) return null;
    return computeClipWindow(selectedTimestampNs, chatDuration, frameRange.minNs, frameRange.maxNs);
  }, [chatDuration, frameRange, selectedTimestampNs]);

  const applyResponse = useCallback((response: SamplesResponse, requestStartNs: number, durationSec: number, reconcileSelection: boolean, preferredSelectedNs: number) => {
    const sorted = response.samples.sort((a, b) => a.timestamp_ns - b.timestamp_ns);
    setSamples(sorted);
    setCameras(response.cameras);
    setAnchorCamera(response.anchor_camera);
    setSampleToleranceNs(response.sample_tolerance_ns);
    const defaultEndNs = requestStartNs + durationSec * 1_000_000_000;
    if (sorted.length > 0) {
      setLoadedRangeStartNs(sorted[0].timestamp_ns);
      setLoadedRangeEndNs(sorted[sorted.length - 1].timestamp_ns);
      if (reconcileSelection) setSelectedTimestampNs(nearestSampleTimestamp(sorted, preferredSelectedNs) ?? preferredSelectedNs);
    } else {
      setLoadedRangeStartNs(requestStartNs);
      setLoadedRangeEndNs(defaultEndNs);
    }
  }, []);

  const loadSamples = useCallback(async ({
    bagPath,
    requestStartNs,
    durationSec,
    preferredSelectedNs,
    requestId,
    reconcileSelection,
  }: {
    bagPath: string;
    requestStartNs: number;
    durationSec: number;
    preferredSelectedNs: number;
    requestId: number;
    reconcileSelection: boolean;
  }) => {
    const isStale = () => requestIdRef.current !== requestId;
    try {
      const response = await getSamples(bagPath, requestStartNs, durationSec);
      if (isStale()) return;
      applyResponse(response, requestStartNs, durationSec, reconcileSelection, preferredSelectedNs);
    } catch (error) {
      if (!isStale()) toast.error(error instanceof Error ? error.message : "Failed to load Samples.");
    } finally {
      if (!isStale()) setIsLoadingSamples(false);
    }
  }, [applyResponse]);

  const resetForResult = useCallback((result: SearchResult, selectedNs: number) => {
    setSelectedResult(result);
    setSelectedTimestampNs(selectedNs);
    setSamples([]);
    setCameras([]);
    setAnchorCamera(null);
    setSampleToleranceNs(null);
    setLoadedRangeStartNs(null);
    setLoadedRangeEndNs(null);
    setCanLoadMoreLeft(true);
    setCanLoadMoreRight(true);
    setChatQuery("");
    setChatResponse(null);
    setChatDuration(DEFAULT_WINDOW_SECONDS);
    setIsLoadingSamples(true);
  }, []);

  const openForBag = useCallback(async ({
    bagPath,
    bagName,
    startNs,
    durationSec = DEFAULT_WINDOW_SECONDS,
  }: {
    bagPath: string;
    bagName: string;
    startNs: number;
    durationSec?: number;
  }) => {
    const synthetic: SearchResult = {
      bag_path: bagPath,
      timestamp_ns: startNs,
      file_path: "",
      topic: "",
      similarity_score: 0,
      source_bag: bagName,
    };
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const windowStartNs = Math.max(0, Math.floor(startNs - (durationSec * 1_000_000_000) / 2));
    resetForResult(synthetic, startNs);
    await loadSamples({
      bagPath,
      requestStartNs: windowStartNs,
      durationSec,
      preferredSelectedNs: startNs,
      requestId,
      reconcileSelection: true,
    });
  }, [loadSamples, resetForResult]);

  const loadMoreLeft = useCallback(async (): Promise<SampleInfo[] | null> => {
    if (!selectedResult || isLoadingSamples || isExtendingLeft || !canLoadMoreLeft) return null;
    const durationSec = PAGED_LOAD_SECONDS;
    const durationNs = durationSec * 1_000_000_000;
    const currentStartNs = loadedRangeStartNs ?? selectedTimestampNs ?? selectedResult.timestamp_ns;
    const requestStartNs = Math.max(0, currentStartNs - durationNs);
    setIsExtendingLeft(true);
    let mergedSamples: SampleInfo[] | null = null;
    try {
      const response = await getSamples(selectedResult.bag_path, requestStartNs, durationSec);
      setCameras(response.cameras);
      setAnchorCamera(response.anchor_camera);
      setSampleToleranceNs(response.sample_tolerance_ns);
      setSamples((prev) => {
        const merged = mergeSamples(prev, response.samples);
        mergedSamples = merged;
        if (merged.length > 0) {
          setLoadedRangeStartNs(merged[0].timestamp_ns);
          setLoadedRangeEndNs(merged[merged.length - 1].timestamp_ns);
        }
        if (merged.length === 0 || merged[0].timestamp_ns >= currentStartNs) setCanLoadMoreLeft(false);
        return merged;
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load older Samples.");
    } finally {
      setIsExtendingLeft(false);
    }
    return mergedSamples;
  }, [canLoadMoreLeft, isExtendingLeft, isLoadingSamples, loadedRangeStartNs, selectedResult, selectedTimestampNs]);

  const loadMoreRight = useCallback(async (): Promise<SampleInfo[] | null> => {
    if (!selectedResult || isLoadingSamples || isExtendingRight || !canLoadMoreRight) return null;
    const durationSec = PAGED_LOAD_SECONDS;
    const currentEndNs = loadedRangeEndNs ?? selectedTimestampNs ?? selectedResult.timestamp_ns;
    const requestStartNs = Math.max(0, currentEndNs + 1);
    setIsExtendingRight(true);
    let mergedSamples: SampleInfo[] | null = null;
    try {
      const response = await getSamples(selectedResult.bag_path, requestStartNs, durationSec);
      setCameras(response.cameras);
      setAnchorCamera(response.anchor_camera);
      setSampleToleranceNs(response.sample_tolerance_ns);
      setSamples((prev) => {
        const merged = mergeSamples(prev, response.samples);
        mergedSamples = merged;
        if (merged.length > 0) {
          setLoadedRangeStartNs(merged[0].timestamp_ns);
          setLoadedRangeEndNs(merged[merged.length - 1].timestamp_ns);
        }
        if (merged.length === 0 || merged[merged.length - 1].timestamp_ns <= currentEndNs) setCanLoadMoreRight(false);
        return merged;
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load newer Samples.");
    } finally {
      setIsExtendingRight(false);
    }
    return mergedSamples;
  }, [canLoadMoreRight, isExtendingRight, isLoadingSamples, loadedRangeEndNs, selectedResult, selectedTimestampNs]);

  const selectPreviousSample = useCallback(async () => {
    if (samples.length === 0 || selectedTimestampNs === null) return;
    const currentIndex = samples.findIndex((sample) => sample.timestamp_ns === selectedTimestampNs);
    if (currentIndex > 0) {
      setSelectedTimestampNs(samples[currentIndex - 1].timestamp_ns);
      return;
    }
    if (!canLoadMoreLeft) return;
    const merged = await loadMoreLeft();
    const nextIndex = merged?.findIndex((sample) => sample.timestamp_ns === selectedTimestampNs) ?? -1;
    if (merged && nextIndex > 0) setSelectedTimestampNs(merged[nextIndex - 1].timestamp_ns);
  }, [canLoadMoreLeft, loadMoreLeft, samples, selectedTimestampNs]);

  const selectNextSample = useCallback(async () => {
    if (samples.length === 0 || selectedTimestampNs === null) return;
    const currentIndex = samples.findIndex((sample) => sample.timestamp_ns === selectedTimestampNs);
    if (currentIndex >= 0 && currentIndex < samples.length - 1) {
      setSelectedTimestampNs(samples[currentIndex + 1].timestamp_ns);
      return;
    }
    if (!canLoadMoreRight) return;
    const merged = await loadMoreRight();
    const nextIndex = merged?.findIndex((sample) => sample.timestamp_ns === selectedTimestampNs) ?? -1;
    if (merged && nextIndex >= 0 && nextIndex < merged.length - 1) setSelectedTimestampNs(merged[nextIndex + 1].timestamp_ns);
  }, [canLoadMoreRight, loadMoreRight, samples, selectedTimestampNs]);

  const jumpToTimestamp = useCallback(async (ns: number) => {
    const withinLoaded = loadedRangeStartNs !== null && loadedRangeEndNs !== null && ns >= loadedRangeStartNs && ns <= loadedRangeEndNs;
    if (withinLoaded) {
      setSelectedTimestampNs(nearestSampleTimestamp(samples, ns) ?? ns);
      return;
    }
    if (!selectedResult) return;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const windowStartNs = Math.max(0, Math.floor(ns - HALF_WINDOW_NS));
    setIsLoadingSamples(true);
    setSelectedTimestampNs(ns);
    setLoadedRangeStartNs(null);
    setLoadedRangeEndNs(null);
    setCanLoadMoreLeft(true);
    setCanLoadMoreRight(true);
    await loadSamples({
      bagPath: selectedResult.bag_path,
      requestStartNs: windowStartNs,
      durationSec: DEFAULT_WINDOW_SECONDS,
      preferredSelectedNs: ns,
      requestId,
      reconcileSelection: true,
    });
  }, [loadedRangeEndNs, loadedRangeStartNs, loadSamples, samples, selectedResult]);

  const runChat = useCallback(async () => {
    if (!selectedResult || selectedTimestampNs === null) return;
    if (!chatQuery.trim()) {
      toast.error("Enter a question for the Sample.");
      return;
    }
    setIsChatting(true);
    setChatResponse(null);
    try {
      const response = await chatWithClip({
        bag_path: selectedResult.bag_path,
        start_ns: vlmWindow?.startNs ?? selectedTimestampNs,
        duration: chatDuration,
        query: chatQuery.trim(),
      });
      setChatResponse(response.response);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Video chat failed.");
    } finally {
      setIsChatting(false);
    }
  }, [chatDuration, chatQuery, selectedResult, selectedTimestampNs, vlmWindow?.startNs]);

  const isSampleInVlmWindow = useCallback((timestampNs: number) => {
    if (!vlmWindow) return false;
    return timestampNs >= vlmWindow.startNs && timestampNs <= vlmWindow.endNs;
  }, [vlmWindow]);

  return {
    activeSample,
    anchorCamera,
    cameras,
    canLoadMoreLeft,
    canLoadMoreRight,
    chatDuration,
    chatQuery,
    chatResponse,
    isChatting,
    isExtendingLeft,
    isExtendingRight,
    isLoadingSamples,
    isSampleInVlmWindow,
    jumpToTimestamp,
    loadMoreLeft,
    loadMoreRight,
    openForBag,
    runChat,
    sampleToleranceNs,
    samples,
    selectNextSample,
    selectPreviousSample,
    selectedResult,
    selectedSampleIndex,
    selectedTimestampNs,
    setChatDuration,
    setChatQuery,
    setSelectedTimestampNs,
    vlmWindowEndNs: vlmWindow?.endNs ?? null,
    vlmWindowStartNs: vlmWindow?.startNs ?? null,
  };
}
```

- [ ] **Step 2: Verify frontend build**

Run from `frontend/`: `rtk npm run build`

Expected: build passes with hook unused.

- [ ] **Step 3: Commit**

```bash
rtk git add frontend/src/hooks/use-sample-browser.ts
rtk git commit -m "[Frontend] Add Sample browser state hook"
```

---

## Task 5: Bag Explorer UI Migration

**Files:**
- Create: `frontend/src/components/bags/bag-sample-browser.tsx`
- Modify: `frontend/src/pages/bags/bag-detail-page.tsx`

- [ ] **Step 1: Create Bag Sample browser component**

Create `frontend/src/components/bags/bag-sample-browser.tsx` by copying the shell structure of `bag-sequence-viewer.tsx`, replacing the single `AuthImage` viewing area with `SampleViewer` and replacing `frames` with `samples`.

Use this prop interface and thumbnail strip rendering:

```tsx
import {
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  MessageSquare,
  MessageSquareOff,
} from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";

import type { SampleInfo, SearchResult } from "../../api/types";
import { SampleViewer } from "../samples/sample-viewer";
import { AuthImage } from "../ui/auth-image";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";

interface BagSampleBrowserProps {
  result: SearchResult | null;
  activeSample: SampleInfo | null;
  samples: SampleInfo[];
  cameras: string[];
  selectedTimestampNs: number | null;
  selectedSampleIndex: number;
  isLoadingSamples: boolean;
  canLoadMoreLeft: boolean;
  canLoadMoreRight: boolean;
  isExtendingLeft: boolean;
  isExtendingRight: boolean;
  chatDuration: number;
  chatQuery: string;
  chatResponse: string | null;
  isChatting: boolean;
  vlmWindowStartNs: number | null;
  vlmWindowEndNs: number | null;
  isSampleInVlmWindow: (timestampNs: number) => boolean;
  onSelectTimestamp: (ns: number) => void;
  onSelectNextSample: () => void;
  onSelectPreviousSample: () => void;
  onLoadMoreLeft: () => void;
  onLoadMoreRight: () => void;
  onChatQueryChange: (value: string) => void;
  onChatDurationChange: (value: number) => void;
  onChat: () => void;
  headerSlot?: ReactNode;
  pinRail?: ReactNode;
  highlightedSampleTimestamps?: Map<number, number>;
  onViewportChange?: (startNs: number | null, endNs: number | null) => void;
  chatOpen?: boolean;
  onChatOpenChange?: (open: boolean) => void;
}

function formatTimestamp(ns: number | null): string {
  if (ns === null) return "-";
  const seconds = ns / 1_000_000_000;
  return `${seconds.toFixed(3)} s (${ns})`;
}

function coverage(sample: SampleInfo, cameraCount: number): string {
  return `${Object.keys(sample.frames_by_camera).length}/${cameraCount}`;
}
```

In the component body, use the same keyboard guard as `BagSequenceViewer`, but wire ArrowLeft to `onSelectPreviousSample` and ArrowRight to `onSelectNextSample`.

The main viewing area must be:

```tsx
<div className="flex min-h-0 flex-1 bg-black">
  <SampleViewer
    cameras={cameras}
    sample={activeSample}
    isLoading={isLoadingSamples}
    className="min-h-0 flex-1"
  />
</div>
```

The thumbnail strip must render anchor Camera thumbnails only:

```tsx
{samples.map((sample) => {
  const selected = sample.timestamp_ns === selectedTimestampNs;
  const inWindow = isSampleInVlmWindow(sample.timestamp_ns);
  const anchorFrame = sample.anchor_frame;
  const isHighlighted = highlightedSampleTimestamps?.has(sample.timestamp_ns) ?? false;
  const score = highlightedSampleTimestamps?.get(sample.timestamp_ns);
  return (
    <button
      key={sample.timestamp_ns}
      ref={(node) => {
        sampleRefs.current[sample.timestamp_ns] = node;
      }}
      type="button"
      onClick={() => onSelectTimestamp(sample.timestamp_ns)}
      aria-pressed={selected}
      aria-label={`Sample at ${formatTimestamp(sample.timestamp_ns)}`}
      className={`relative h-14 w-24 shrink-0 overflow-hidden rounded border-2 ${
        selected ? "border-[var(--teal)]" : inWindow ? "border-[var(--teal)]/40" : "border-transparent"
      } ${isHighlighted ? "ring-2 ring-[#f59e0b] ring-offset-1" : ""}`}
      title={String(sample.timestamp_ns)}
    >
      {anchorFrame ? (
        <AuthImage filePath={anchorFrame.file_path} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="h-full w-full bg-black" />
      )}
      <span className="absolute bottom-1 left-1 rounded-sm bg-black/70 px-1 text-[9px] font-semibold leading-none text-white">
        {coverage(sample, cameras.length)}
      </span>
      {isHighlighted && score !== undefined ? (
        <span className="absolute right-1 top-1 rounded-sm bg-[#16a085] px-1 text-[9px] font-semibold leading-none text-white">
          {score.toFixed(2)}
        </span>
      ) : null}
    </button>
  );
})}
```

Retain the existing chat panel markup from `BagSequenceViewer`, changing "Frame" copy to "Sample" where visible.

- [ ] **Step 2: Switch Bag detail page to Sample browser**

In `frontend/src/pages/bags/bag-detail-page.tsx`:

Replace imports:

```ts
import { BagSampleBrowser } from "../../components/bags/bag-sample-browser";
import { useSampleBrowser } from "../../hooks/use-sample-browser";
```

Remove:

```ts
import { BagSequenceViewer } from "../../components/bags/bag-sequence-viewer";
import { useSequenceViewer } from "../../hooks/use-sequence-viewer";
```

Replace:

```ts
const viewerState = useSequenceViewer();
```

with:

```ts
const viewerState = useSampleBrowser();
```

Replace the initial open call:

```ts
void viewerState.openForBag({
  bagPath,
  bagName: resolvedBag.bag_name,
  startNs,
});
```

Replace Search-region support button condition so it promotes the focused or first visible Frame in the current Sample:

```ts
const activeSupportFrame = viewerState.activeSample
  ? Object.values(viewerState.activeSample.frames_by_camera).find((frame) => frame.is_focus)
    ?? viewerState.activeSample.anchor_frame
    ?? Object.values(viewerState.activeSample.frames_by_camera)[0]
  : null;
```

Then use `activeSupportFrame?.file_path` in the "Search region" button.

Build Sample thumbnail highlights before `pinRail`:

```ts
const highlightedSampleTimestamps = useMemo(() => {
  const byPinTimestamp = new Map<number, number>();
  for (const p of pins) {
    if (p.score !== undefined) byPinTimestamp.set(p.timestamp_ns, p.score);
  }
  const out = new Map<number, number>();
  for (const sample of viewerState.samples) {
    for (const frame of Object.values(sample.frames_by_camera)) {
      const score = byPinTimestamp.get(frame.timestamp_ns);
      if (score !== undefined) {
        out.set(sample.timestamp_ns, Math.max(out.get(sample.timestamp_ns) ?? 0, score));
      }
    }
  }
  return out;
}, [pins, viewerState.samples]);
```

Replace the returned viewer component with:

```tsx
<BagSampleBrowser
  result={viewerState.selectedResult}
  activeSample={viewerState.activeSample}
  samples={viewerState.samples}
  cameras={viewerState.cameras}
  selectedTimestampNs={viewerState.selectedTimestampNs}
  selectedSampleIndex={viewerState.selectedSampleIndex}
  isLoadingSamples={viewerState.isLoadingSamples}
  canLoadMoreLeft={viewerState.canLoadMoreLeft}
  canLoadMoreRight={viewerState.canLoadMoreRight}
  isExtendingLeft={viewerState.isExtendingLeft}
  isExtendingRight={viewerState.isExtendingRight}
  chatDuration={viewerState.chatDuration}
  chatQuery={viewerState.chatQuery}
  chatResponse={viewerState.chatResponse}
  isChatting={viewerState.isChatting}
  vlmWindowStartNs={viewerState.vlmWindowStartNs}
  vlmWindowEndNs={viewerState.vlmWindowEndNs}
  isSampleInVlmWindow={viewerState.isSampleInVlmWindow}
  onSelectTimestamp={viewerState.setSelectedTimestampNs}
  onSelectNextSample={() => void viewerState.selectNextSample()}
  onSelectPreviousSample={() => void viewerState.selectPreviousSample()}
  onLoadMoreLeft={() => void viewerState.loadMoreLeft()}
  onLoadMoreRight={() => void viewerState.loadMoreRight()}
  onChatQueryChange={viewerState.setChatQuery}
  onChatDurationChange={viewerState.setChatDuration}
  onChat={() => void viewerState.runChat()}
  headerSlot={headerSlot}
  pinRail={pinRail}
  highlightedSampleTimestamps={highlightedSampleTimestamps}
  onViewportChange={handleViewportChange}
  chatOpen={chatOpen}
  onChatOpenChange={setChatOpen}
/>
```

For extraction, keep `centerNs: viewerState.selectedTimestampNs`.

- [ ] **Step 3: Verify frontend build and lint**

Run from `frontend/`: `rtk npm run lint`

Expected: no ESLint errors.

Run from `frontend/`: `rtk npm run build`

Expected: TypeScript and Vite build pass.

- [ ] **Step 4: Commit**

```bash
rtk git add frontend/src/components/bags/bag-sample-browser.tsx frontend/src/pages/bags/bag-detail-page.tsx
rtk git commit -m "[UI] Migrate Bag Explorer to Sample browsing"
```

---

## Task 6: Search Result Cards Open an In-Page Sample Lightbox

**Files:**
- Modify: `frontend/src/components/search/image-card.tsx`
- Modify: `frontend/src/components/search/results-grid.tsx`
- Create: `frontend/src/components/search/sample-result-lightbox.tsx`
- Modify: `frontend/src/pages/search.tsx`

- [ ] **Step 1: Add explicit Explorer action to result cards**

In `frontend/src/components/search/image-card.tsx`, add `ExternalLink` to imports:

```ts
import { Crosshair, ExternalLink, Search } from "lucide-react";
```

Extend props:

```ts
explorerHref?: string;
```

Destructure it:

```ts
export function ImageCard({ result, href, explorerHref, onClick, onSimilarSearch, onUseAsRegionSupport }: ImageCardProps) {
```

Add this button before the Similar button:

```tsx
{explorerHref ? (
  <Button asChild type="button" variant="ghost" size="icon" className="h-8 w-8" title="Open in Explorer" aria-label="Open in Explorer">
    <Link to={explorerHref}>
      <ExternalLink className="h-4 w-4" />
    </Link>
  </Button>
) : null}
```

- [ ] **Step 2: Forward Explorer href from ResultsGrid**

In `frontend/src/components/search/results-grid.tsx`, rename the prop comment so `getResultHref` means explicit Explorer action. Pass it to `ImageCard` as `explorerHref` and continue passing `href` only when callers need linked image behavior:

```tsx
<ImageCard
  key={`${result.file_path}:${result.timestamp_ns}`}
  result={result}
  explorerHref={getResultHref?.(result)}
  onClick={onResultClick ? () => onResultClick(result) : undefined}
  onSimilarSearch={onSimilarSearch}
  onUseAsRegionSupport={onUseAsRegionSupport}
/>
```

This makes normal card clicks available to `/search` while keeping the Explorer action explicit.

- [ ] **Step 3: Create Search Sample lightbox**

Create `frontend/src/components/search/sample-result-lightbox.tsx`:

```tsx
import { ArrowLeft, ArrowRight, Crosshair, ExternalLink, Flame, LoaderCircle, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { getSamples } from "../../api/client";
import type { HeatmapResponse, SampleInfo, SearchResult } from "../../api/types";
import { SampleViewer } from "../samples/sample-viewer";
import { Button } from "../ui/button";

interface SampleResultLightboxProps {
  results: SearchResult[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  fetchHeatmap?: (targetFilePath: string) => Promise<HeatmapResponse | null>;
  getResultHref: (result: SearchResult) => string;
  onUseAsRegionSupport: (result: SearchResult) => void;
}

const FOCUS_WINDOW_SEC = 1;

export function SampleResultLightbox({
  results,
  index,
  onIndexChange,
  onClose,
  fetchHeatmap,
  getResultHref,
  onUseAsRegionSupport,
}: SampleResultLightboxProps) {
  const result = results[index];
  const [sample, setSample] = useState<SampleInfo | null>(null);
  const [cameras, setCameras] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [opacity, setOpacity] = useState(0.6);
  const [heatmaps, setHeatmaps] = useState<Record<string, HeatmapResponse | undefined>>({});
  const [heatmapLoading, setHeatmapLoading] = useState<Record<string, boolean | undefined>>({});

  useEffect(() => {
    if (!result) return;
    let cancelled = false;
    setIsLoading(true);
    setSample(null);
    getSamples(result.bag_path, result.timestamp_ns, FOCUS_WINDOW_SEC, result.file_path)
      .then((response) => {
        if (cancelled) return;
        setCameras(response.cameras);
        setSample(response.samples[0] ?? null);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [result]);

  const visibleFilePaths = useMemo(() => {
    if (!sample) return [];
    return Object.values(sample.frames_by_camera).map((frame) => frame.file_path);
  }, [sample]);

  useEffect(() => {
    if (!showHeatmap || !fetchHeatmap || visibleFilePaths.length === 0) return;
    let cancelled = false;
    for (const filePath of visibleFilePaths) {
      if (heatmaps[filePath] || heatmapLoading[filePath]) continue;
      setHeatmapLoading((prev) => ({ ...prev, [filePath]: true }));
      fetchHeatmap(filePath)
        .then((heatmap) => {
          if (!cancelled && heatmap) {
            setHeatmaps((prev) => ({ ...prev, [filePath]: heatmap }));
          }
        })
        .finally(() => {
          if (!cancelled) {
            setHeatmapLoading((prev) => ({ ...prev, [filePath]: false }));
          }
        });
    }
    return () => {
      cancelled = true;
    };
  }, [fetchHeatmap, heatmapLoading, heatmaps, showHeatmap, visibleFilePaths]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft" && index > 0) onIndexChange(index - 1);
      if (event.key === "ArrowRight" && index < results.length - 1) onIndexChange(index + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, onClose, onIndexChange, results.length]);

  if (!result) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/90" role="dialog" aria-modal="true">
      <div className="flex items-center justify-between gap-3 px-4 py-3 text-white">
        <div className="min-w-0 text-sm">
          <span className="font-semibold">{result.source_bag}</span>
          <span className="ml-2 font-mono text-xs text-white/70">
            {result.similarity_score != null ? `${(result.similarity_score * 100).toFixed(2)}% - ` : ""}{result.topic}
          </span>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 hover:bg-white/10">
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 items-center px-4">
        <button
          type="button"
          onClick={() => index > 0 && onIndexChange(index - 1)}
          disabled={index === 0}
          aria-label="Previous result"
          className="mr-3 rounded-full p-2 text-white/80 hover:bg-white/10 disabled:opacity-30"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>

        <SampleViewer
          cameras={cameras}
          sample={sample}
          isLoading={isLoading}
          showHeatmaps={showHeatmap}
          heatmapOpacity={opacity}
          heatmaps={heatmaps}
          heatmapLoading={heatmapLoading}
          className="h-[72vh] min-h-[360px] flex-1"
        />

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
        {fetchHeatmap ? (
          <>
            <button
              type="button"
              onClick={() => setShowHeatmap((v) => !v)}
              className={
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs " +
                (showHeatmap ? "border-[var(--teal)] bg-[var(--teal)]/30" : "border-white/30 hover:bg-white/10")
              }
            >
              <Flame className="h-3.5 w-3.5" />
              {showHeatmap && Object.values(heatmapLoading).some(Boolean) ? "Loading" : "Heatmap"}
            </button>
            <label className="flex items-center gap-2 text-xs text-white/80">
              Opacity
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={opacity}
                onChange={(event) => setOpacity(Number(event.target.value))}
                disabled={!showHeatmap}
                className="accent-[var(--teal)]"
              />
            </label>
          </>
        ) : null}
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
        {isLoading ? <LoaderCircle className="h-4 w-4 animate-spin text-white/70" /> : null}
        <span className="text-xs text-white/60">{index + 1} / {results.length}</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Wire Search page lightbox state**

In `frontend/src/pages/search.tsx`, replace the Region lightbox import:

```ts
import { SampleResultLightbox } from "../components/search/sample-result-lightbox";
```

Remove:

```ts
import { RegionResultLightbox } from "../components/search/region-result-lightbox";
```

Replace `lightboxIndex` with:

```ts
const [lightbox, setLightbox] = useState<{ mode: "global" | "region"; index: number } | null>(null);
```

Replace `openLightbox` with:

```ts
const openGlobalLightbox = (result: SearchResult) => {
  const i = search.results.findIndex(
    (r) => r.file_path === result.file_path && r.timestamp_ns === result.timestamp_ns,
  );
  if (i >= 0) setLightbox({ mode: "global", index: i });
};

const openRegionLightbox = (result: SearchResult) => {
  const filtered = region.results.filter((r) => (r.similarity_score ?? 1) >= search.minScore);
  const i = filtered.findIndex(
    (r) => r.file_path === result.file_path && r.timestamp_ns === result.timestamp_ns,
  );
  if (i >= 0) setLightbox({ mode: "region", index: i });
};
```

In `setMode`, replace `setLightboxIndex(null)` with `setLightbox(null)`.

In `handleUseForRegion`, replace `setLightboxIndex(null)` with `setLightbox(null)`.

For Global results, pass normal click:

```tsx
<ResultsGrid
  results={search.results}
  isSearching={false}
  getResultHref={getResultHref}
  onResultClick={openGlobalLightbox}
  onSimilarSearch={handleSimilar}
  onUseAsRegionSupport={handleUseForRegion}
/>
```

For Region results, replace `onResultClick={openLightbox}` with:

```tsx
onResultClick={openRegionLightbox}
```

Replace the final Region-only lightbox render with:

```tsx
{lightbox ? (
  <SampleResultLightbox
    results={lightbox.mode === "global" ? search.results : regionResults}
    index={lightbox.index}
    onIndexChange={(index) => setLightbox((current) => current ? { ...current, index } : current)}
    onClose={() => setLightbox(null)}
    fetchHeatmap={lightbox.mode === "region" ? region.fetchHeatmap : undefined}
    getResultHref={getResultHref}
    onUseAsRegionSupport={handleUseForRegion}
  />
) : null}
```

- [ ] **Step 5: Verify Search frontend build and lint**

Run from `frontend/`: `rtk npm run lint`

Expected: no ESLint errors.

Run from `frontend/`: `rtk npm run build`

Expected: TypeScript and Vite build pass.

- [ ] **Step 6: Commit**

```bash
rtk git add frontend/src/components/search/image-card.tsx frontend/src/components/search/results-grid.tsx frontend/src/components/search/sample-result-lightbox.tsx frontend/src/pages/search.tsx
rtk git commit -m "[UI] Add Search Sample result lightbox"
```

---

## Task 7: Final Verification and Manual Checks

**Files:**
- Review: `docs/superpowers/specs/2026-06-03-sample-viewer-design.md`
- Review: `CONTEXT.md`

- [ ] **Step 1: Run backend focused and contract tests**

Run:

```bash
rtk uv run pytest tests/test_bags_samples.py tests/test_bags_track.py tests/test_api_contracts.py -v
```

Expected: all selected tests pass.

- [ ] **Step 2: Run frontend lint and build**

Run from `frontend/`:

```bash
rtk npm run lint
rtk npm run build
```

Expected: lint passes; TypeScript and Vite build pass.

- [ ] **Step 3: Manual browser checks**

Start backend and frontend using the repo's normal workflow, then check:

```bash
rtk uv run uvicorn app:app --reload
```

From `frontend/` in another shell:

```bash
rtk npm run dev
```

Manual acceptance:
- `/bags/:bagId` opens a Sample grid, not a single image.
- A three-Camera Bag defaults to one row with three tiles.
- Missing Camera Frames render as black placeholders.
- Bag Explorer left/right arrows move through time.
- The thumbnail strip shows anchor Camera images only and displays coverage such as `3/3` or `2/3`.
- The layout editor shows Camera identity, moves Cameras between slots, saves to `localStorage`, and reset restores the deterministic default.
- Global Search result click opens the Sample lightbox; "Open in Explorer" is a separate action.
- Search lightbox left/right arrows move through ranked results, not Bag time.
- Region Search lightbox shows Heatmap controls, fetches heatmaps only after toggle, and overlays every visible non-missing Sample Frame.
- Bag Explorer chat and extraction still use the selected Sample timestamp.

- [ ] **Step 4: Run a placeholder scan on the plan and spec**

Run:

```bash
rtk uv run python -c "from pathlib import Path; terms=[chr(84)+chr(79)+chr(68)+chr(79), chr(84)+chr(66)+chr(68)]; paths=[Path('docs/superpowers/plans/2026-06-03-synchronized-sample-viewer.md'), Path('docs/superpowers/specs/2026-06-03-sample-viewer-design.md')]; print([(str(p), *(p.read_text().count(term) for term in terms)) for p in paths])"
```

Expected: both files report zero counts for the two scanned terms.

- [ ] **Step 5: Commit verification-only doc updates if any were needed**

If executing the plan required tightening this plan after discovering a mismatch, commit that plan update:

```bash
rtk git add docs/superpowers/plans/2026-06-03-synchronized-sample-viewer.md
rtk git commit -m "[Docs] Tighten synchronized Sample viewer implementation plan"
```

---

## Self-Review

**Spec coverage:** Backend API, dynamic Cameras, fallback Camera derivation, tolerance, missing Camera omission, focus Frame forcing, shared Sample viewer, user layout persistence, Bag Explorer Sample browsing, Search ranked-result lightbox navigation, Region heatmap toggle, chat/extraction timestamp behavior, and `/workspace` non-scope are all mapped to tasks.

**Type consistency:** Backend response keys match frontend `SamplesResponse`. Frontend `SampleViewer` consumes `SampleInfo.frames_by_camera` keyed by Camera topic, and Bag/Search callers pass the same `cameras[]` from the Sample API.

**Known execution note:** `CLAUDE.md` still describes older roadmap status and old config wording. Use current code and the 2026-06-03 spec as source of truth for this effort.
