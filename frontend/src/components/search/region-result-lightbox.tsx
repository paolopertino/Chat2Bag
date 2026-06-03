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
  // Heatmap is cached keyed by file path, so navigating to another result
  // ignores the stale grid in render and refetches — no reset effect needed.
  const [heatmap, setHeatmap] = useState<{ filePath: string; data: HeatmapResponse } | null>(null);
  const [loadingHeatmap, setLoadingHeatmap] = useState(false);

  // Lazily fetch the heatmap when toggled on (or when stepping to a new result).
  useEffect(() => {
    if (!showHeatmap || !result) return;
    if (heatmap?.filePath === result.file_path) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoadingHeatmap(true);
    fetchHeatmap(result.file_path)
      .then((hm) => {
        if (!cancelled && hm) setHeatmap({ filePath: result.file_path, data: hm });
      })
      .finally(() => {
        if (!cancelled) setLoadingHeatmap(false);
      });
    return () => {
      cancelled = true;
    };
  }, [showHeatmap, heatmap, result, fetchHeatmap]);

  const activeHeatmap = heatmap?.filePath === result?.file_path ? heatmap.data : null;

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
          {showHeatmap && activeHeatmap ? (
            <HeatmapOverlay heatmap={activeHeatmap} opacity={opacity} className="absolute inset-0 rounded-md" />
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
