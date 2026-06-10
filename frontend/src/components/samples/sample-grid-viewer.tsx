import { useState } from "react";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

import type { HeatmapResponse, SampleInfo } from "../../api/types";
import {
  GRID_COLS,
  readCameraLayoutV2,
  saveCameraLayoutV2,
  type CameraLayoutV2,
} from "../../lib/sample-camera-layout";
import { ReactGridLayout, WidthProvider, type RglLayout } from "../../lib/rgl-compat";
import { HeatmapOverlay } from "../search/heatmap-overlay";
import { AuthImage } from "../ui/auth-image";

const Grid = WidthProvider(ReactGridLayout);

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
  const camKey = [...cameras].sort().join("|");
  const [lastCamKey, setLastCamKey] = useState(camKey);
  const [layout, setLayout] = useState<CameraLayoutV2>(() => readCameraLayoutV2(cameras));
  const [maximized, setMaximized] = useState<string | null>(null);

  // React-recommended derived-state pattern: update synchronously on next render
  // when the camera set changes (different bag opened through the same mount).
  if (lastCamKey !== camKey) {
    setLastCamKey(camKey);
    setLayout(readCameraLayoutV2(cameras));
  }

  const rglLayout: RglLayout[] = cameras.map((camera) => ({
    i: camera,
    ...(layout.tiles[camera] ?? { x: 0, y: 0, w: 3, h: 4 }),
  }));

  function onLayoutChange(next: RglLayout[]) {
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
    return <div className={"relative h-full " + (className ?? "")}>{tile(maximized)}</div>;
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
