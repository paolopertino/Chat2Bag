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
