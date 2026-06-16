import { useEffect, useRef, useState } from "react";
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

const GRID_MARGIN = 6;
// Landscape fallback until the first frame reports its true aspect; refined on load
// so the grid adapts to whatever resolution the cameras actually produce.
const DEFAULT_IMAGE_ASPECT = 16 / 10;

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
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [imageAspect, setImageAspect] = useState(DEFAULT_IMAGE_ASPECT);

  // Track the available width so a grid cell can be sized to render the frame at
  // its native aspect ratio. With rowHeight = colWidth / imageAspect, a square
  // (w === h) tile is exactly imageAspect wide-to-tall, so the default layout
  // shows full frames with no letterbox bars — and it holds across surfaces
  // (narrow bag viewer vs full-width lightbox) since both width and height scale
  // with the column width.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      if (width > 0) setContainerWidth(width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Mirrors react-grid-layout's column-width math (containerPadding defaults to margin).
  const colWidth =
    containerWidth > 0 ? (containerWidth - GRID_MARGIN * (GRID_COLS + 1)) / GRID_COLS : 0;
  const rowHeight = colWidth > 0 ? colWidth / imageAspect : 56;

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
          <AuthImage
            filePath={frame.file_path}
            alt={camera}
            className="h-full w-full object-contain"
            onNaturalAspect={(aspect) =>
              setImageAspect((prev) => (Math.abs(prev - aspect) > 0.01 ? aspect : prev))
            }
          />
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
        <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[10px] text-white opacity-80">
          {camera}
        </span>
      </div>
    );
  }

  if (maximized) {
    return <div className={"relative h-full " + (className ?? "")}>{tile(maximized)}</div>;
  }

  return (
    <div ref={containerRef} className={"h-full overflow-y-auto " + (className ?? "")}>
      <Grid
        layout={rglLayout}
        cols={GRID_COLS}
        rowHeight={rowHeight}
        margin={[GRID_MARGIN, GRID_MARGIN]}
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
