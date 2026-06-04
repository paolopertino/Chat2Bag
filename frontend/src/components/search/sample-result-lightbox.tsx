import { ArrowLeft, ArrowRight, Crosshair, ExternalLink, Flame, X } from "lucide-react";
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

interface SampleLoadState {
  key: string;
  cameras: string[];
  sample: SampleInfo | null;
  isLoading: boolean;
  error: string | null;
}

function resultKey(result: SearchResult): string {
  return `${result.bag_path}:${result.timestamp_ns}:${result.file_path}`;
}

function pickSample(samples: SampleInfo[], result: SearchResult): SampleInfo | null {
  return (
    samples.find((sample) =>
      Object.values(sample.frames_by_camera).some(
        (frame) => frame.file_path === result.file_path && frame.is_focus,
      ),
    ) ??
    samples.find((sample) =>
      sample.anchor_frame?.file_path === result.file_path
      || Object.values(sample.frames_by_camera).some((frame) => frame.file_path === result.file_path),
    ) ??
    samples.find((sample) => sample.timestamp_ns === result.timestamp_ns) ??
    samples[0] ??
    null
  );
}

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
  const key = result ? resultKey(result) : "";
  const [sampleState, setSampleState] = useState<SampleLoadState>({
    key: "",
    cameras: [],
    sample: null,
    isLoading: false,
    error: null,
  });
  const [showHeatmaps, setShowHeatmaps] = useState(false);
  const [opacity, setOpacity] = useState(0.6);
  const [heatmaps, setHeatmaps] = useState<Record<string, HeatmapResponse | undefined>>({});
  const [heatmapLoading, setHeatmapLoading] = useState<Record<string, boolean | undefined>>({});

  useEffect(() => {
    if (!result) return;
    let cancelled = false;

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSampleState((previous) => ({
      key,
      cameras: previous.key === key ? previous.cameras : [],
      sample: previous.key === key ? previous.sample : null,
      isLoading: true,
      error: null,
    }));

    getSamples(result.bag_path, result.timestamp_ns, 1, result.file_path)
      .then((response) => {
        if (cancelled) return;
        setSampleState({
          key,
          cameras: response.cameras,
          sample: pickSample(response.samples, result),
          isLoading: false,
          error: null,
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setSampleState({
          key,
          cameras: [],
          sample: null,
          isLoading: false,
          error: error instanceof Error ? error.message : "Sample unavailable.",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [key, result]);

  const activeSampleState = sampleState.key === key ? sampleState : null;
  const cameras = activeSampleState?.cameras ?? [];
  const sample = activeSampleState?.sample ?? null;
  const isLoadingSample = Boolean(result) && (!activeSampleState || activeSampleState.isLoading);

  const visibleFilePaths = useMemo(() => {
    if (!sample) return [];
    return Object.values(sample.frames_by_camera).map((frame) => frame.file_path);
  }, [sample]);

  useEffect(() => {
    if (!showHeatmaps || !fetchHeatmap || visibleFilePaths.length === 0) return;
    const missing = visibleFilePaths.filter((filePath) => !heatmaps[filePath] && !heatmapLoading[filePath]);
    if (missing.length === 0) return;

    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHeatmapLoading((previous) => {
      const next = { ...previous };
      for (const filePath of missing) next[filePath] = true;
      return next;
    });

    for (const filePath of missing) {
      fetchHeatmap(filePath)
        .then((heatmap) => {
          if (!cancelled && heatmap) {
            setHeatmaps((previous) => ({ ...previous, [filePath]: heatmap }));
          }
        })
        .catch(() => null)
        .finally(() => {
          if (!cancelled) {
            setHeatmapLoading((previous) => ({ ...previous, [filePath]: false }));
          }
        });
    }

    return () => {
      cancelled = true;
    };
  }, [fetchHeatmap, heatmapLoading, heatmaps, showHeatmaps, visibleFilePaths]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft" && index > 0) onIndexChange(index - 1);
      if (event.key === "ArrowRight" && index < results.length - 1) onIndexChange(index + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, results.length, onClose, onIndexChange]);

  if (!result) return null;

  const canShowHeatmaps = Boolean(fetchHeatmap);

  return (
    <div className="fixed inset-0 z-50 flex min-h-0 flex-col bg-black/90" role="dialog" aria-modal="true">
      <div className="flex items-center justify-between gap-3 px-4 py-3 text-white">
        <div className="min-w-0 text-sm">
          <span className="font-semibold">{result.source_bag}</span>
          <span className="ml-2 font-mono text-xs text-white/70">
            {result.similarity_score != null ? `${(result.similarity_score * 100).toFixed(2)}% · ` : ""}
            {result.topic}
          </span>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 hover:bg-white/10">
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 items-center px-3">
        <button
          type="button"
          onClick={() => index > 0 && onIndexChange(index - 1)}
          disabled={index === 0}
          aria-label="Previous result"
          className="mr-3 rounded-full p-2 text-white/80 hover:bg-white/10 disabled:opacity-30"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>

        <div className="min-h-0 flex-1">
          <SampleViewer
            cameras={cameras}
            sample={sample}
            isLoading={isLoadingSample}
            heatmaps={heatmaps}
            heatmapLoading={heatmapLoading}
            showHeatmaps={canShowHeatmaps && showHeatmaps}
            heatmapOpacity={opacity}
            className="h-full rounded-md"
          />
          {activeSampleState?.error ? (
            <p className="mt-2 text-center text-xs text-white/70">{activeSampleState.error}</p>
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
        {canShowHeatmaps ? (
          <>
            <button
              type="button"
              onClick={() => setShowHeatmaps((value) => !value)}
              className={
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs " +
                (showHeatmaps ? "border-[var(--teal)] bg-[var(--teal)]/30" : "border-white/30 hover:bg-white/10")
              }
            >
              <Flame className="h-3.5 w-3.5" />
              Heatmap
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
                disabled={!showHeatmaps}
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
        <span className="text-xs text-white/60">
          {index + 1} / {results.length}
        </span>
      </div>
    </div>
  );
}
