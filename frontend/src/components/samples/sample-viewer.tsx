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
import { useMemo, useState } from "react";

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
import { HeatmapOverlay } from "../search/heatmap-overlay";
import { AuthImage } from "../ui/auth-image";
import { Button } from "../ui/button";

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

const EMPTY_HEATMAPS: Record<string, HeatmapResponse | undefined> = {};
const EMPTY_HEATMAP_LOADING: Record<string, boolean | undefined> = {};

function shortCameraName(topic: string): string {
  const parts = topic.split("/").filter(Boolean);
  return parts.slice(-2).join("/") || topic;
}

export function SampleViewer({
  cameras,
  sample,
  isLoading = false,
  heatmaps = EMPTY_HEATMAPS,
  heatmapLoading = EMPTY_HEATMAP_LOADING,
  showHeatmaps = false,
  heatmapOpacity = 0.6,
  className,
}: SampleViewerProps) {
  const cameraKey = cameras.join("\u0000");
  const storedLayout = useMemo(() => readCameraLayout(cameras), [cameras]);
  const [layoutState, setLayoutState] = useState<{
    cameraKey: string;
    editMode: boolean;
    layout: CameraLayout;
  }>(() => ({
    cameraKey,
    editMode: false,
    layout: storedLayout,
  }));
  const layout =
    layoutState.cameraKey === cameraKey ? layoutState.layout : storedLayout;
  const editMode = layoutState.cameraKey === cameraKey ? layoutState.editMode : false;

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
    setLayoutState({
      cameraKey,
      editMode,
      layout: swapCameraSlots(layout, camera, direction),
    });
  };

  const saveLayout = () => {
    saveCameraLayout(layout);
    setLayoutState({ cameraKey, editMode: false, layout });
  };

  const resetLayout = () => {
    clearCameraLayout(cameras);
    setLayoutState({ cameraKey, editMode, layout: defaultCameraLayout(cameras) });
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
      <div
        className={cn(
          "flex min-h-[320px] items-center justify-center bg-black text-sm text-white/70",
          className,
        )}
      >
        No sample available.
      </div>
    );
  }

  return (
    <div className={cn("relative flex min-h-0 flex-1 flex-col bg-black", className)}>
      <div className="absolute right-3 top-3 z-20 flex gap-1">
        {editMode ? (
          <>
            <Button
              type="button"
              size="icon"
              variant="secondary"
              onClick={saveLayout}
              title="Save Camera layout"
              aria-label="Save Camera layout"
            >
              <Save className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="secondary"
              onClick={resetLayout}
              title="Reset Camera layout"
              aria-label="Reset Camera layout"
            >
              <RotateCcw className="h-4 w-4" />
            </Button>
          </>
        ) : null}
        <Button
          type="button"
          size="icon"
          variant="secondary"
          onClick={() => setLayoutState({ cameraKey, editMode: !editMode, layout })}
          title="Edit Camera layout"
          aria-label="Edit Camera layout"
        >
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
                <div
                  className={cn(
                    "relative h-full w-full",
                    frame.is_focus ? "ring-2 ring-[var(--teal)] ring-inset" : "",
                  )}
                >
                  <AuthImage
                    filePath={frame.file_path}
                    alt={shortCameraName(camera)}
                    className="h-full w-full object-contain"
                  />
                  {showHeatmaps && heatmap ? (
                    <HeatmapOverlay
                      heatmap={heatmap}
                      opacity={heatmapOpacity}
                      className="absolute inset-0"
                    />
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
                  <div className="truncate text-xs font-semibold" title={camera}>
                    {shortCameraName(camera)}
                  </div>
                  <div className="mt-2 flex gap-1">
                    <Button
                      type="button"
                      size="icon"
                      variant="secondary"
                      className="h-7 w-7"
                      onClick={() => moveCamera(camera, "left")}
                      title="Move left"
                      aria-label="Move left"
                    >
                      <ArrowLeft className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="secondary"
                      className="h-7 w-7"
                      onClick={() => moveCamera(camera, "right")}
                      title="Move right"
                      aria-label="Move right"
                    >
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="secondary"
                      className="h-7 w-7"
                      onClick={() => moveCamera(camera, "up")}
                      title="Move up"
                      aria-label="Move up"
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="secondary"
                      className="h-7 w-7"
                      onClick={() => moveCamera(camera, "down")}
                      title="Move down"
                      aria-label="Move down"
                    >
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
