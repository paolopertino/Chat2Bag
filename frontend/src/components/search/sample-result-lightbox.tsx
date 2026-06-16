import { ArrowLeft, ArrowRight, Crosshair, Download, ExternalLink, Flame, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { getSamples } from "../../api/client";
import type { HeatmapResponse, SampleInfo, SearchResult } from "../../api/types";
import { useHeatmaps } from "../../hooks/use-heatmaps";
import { framesFromSample, type SupportFrame } from "../../lib/region-support";
import { SampleGridViewer } from "../samples/sample-grid-viewer";
import { Button } from "../ui/button";

// Track previews click a GPS timestamp, not a frame timestamp — probe a window wide
// enough to contain a nearby camera sample (mirrors the bag viewer's default window).
const PREVIEW_WINDOW_SECONDS = 10;

interface SampleResultLightboxProps {
  results: SearchResult[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  fetchHeatmap?: (targetFilePath: string) => Promise<HeatmapResponse | null>;
  getResultHref: (result: SearchResult) => string;
  onUseAsRegionSupport: (frames: SupportFrame[], selectedFilePath: string) => void;
  onExtract?: (result: SearchResult) => void;
  onOpenInBag?: (result: SearchResult) => void;
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
  if (samples.length === 0) return null;
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
    // Track previews click a GPS timestamp that rarely lands exactly on a frame, so
    // fall back to the sample nearest the requested time rather than the first one.
    samples.reduce((best, sample) =>
      Math.abs(sample.timestamp_ns - result.timestamp_ns) <
      Math.abs(best.timestamp_ns - result.timestamp_ns)
        ? sample
        : best,
    )
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
  onExtract,
  onOpenInBag,
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

    // A focused result (search hit) resolves to an exact frame, so a 1s probe is
    // enough. A track preview clicks a GPS timestamp with no focus frame; camera
    // frames are sparse (~1 FPS) and rarely fall inside a 1s forward window, so query
    // a wider window centred on the click and let pickSample snap to the nearest sample.
    const hasFocus = Boolean(result.file_path);
    const durationSec = hasFocus ? 1 : PREVIEW_WINDOW_SECONDS;
    const startNs = hasFocus
      ? result.timestamp_ns
      : Math.max(0, Math.floor(result.timestamp_ns - (durationSec * 1_000_000_000) / 2));

    getSamples(result.bag_path, startNs, durationSec, result.file_path)
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

  const heatmaps = useHeatmaps(visibleFilePaths, fetchHeatmap, showHeatmaps);

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
          {isLoadingSample ? (
            <div className="flex min-h-[320px] items-center justify-center bg-black rounded-md">
              <span className="text-xs text-white/60">Loading…</span>
            </div>
          ) : (
            <SampleGridViewer
              cameras={cameras}
              sample={sample}
              editMode={false}
              heatmaps={heatmaps}
              showHeatmaps={canShowHeatmaps && showHeatmaps}
              heatmapOpacity={opacity}
              className="h-full rounded-md"
            />
          )}
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
                (showHeatmaps ? "border-[var(--teal)] bg-[rgb(var(--teal-rgb)/0.3)]" : "border-white/30 hover:bg-white/10")
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
          onClick={() => {
            const built = sample ? framesFromSample(cameras, sample) : { frames: [], defaultSelected: "" };
            let frames = built.frames;
            if (!frames.some((f) => f.filePath === result.file_path)) {
              frames = [{ camera: result.topic, filePath: result.file_path }, ...frames];
            }
            onUseAsRegionSupport(frames, result.file_path);
          }}
          className="inline-flex items-center gap-1.5 rounded-full border border-white/30 px-3 py-1 text-xs hover:bg-white/10"
        >
          <Crosshair className="h-3.5 w-3.5" /> Use as region support
        </button>
        {onExtract ? (
          <button
            type="button"
            onClick={() => onExtract(result)}
            className="inline-flex items-center gap-1.5 rounded-full border border-white/30 px-3 py-1 text-xs hover:bg-white/10"
          >
            <Download className="h-3.5 w-3.5" /> Extract…
          </button>
        ) : null}
        {onOpenInBag ? (
          <Button variant="secondary" size="sm" onClick={() => onOpenInBag(result)}>
            <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> Open in Explorer
          </Button>
        ) : (
          <Button asChild variant="secondary" size="sm">
            <Link to={getResultHref(result)}>
              <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> Open in Explorer
            </Link>
          </Button>
        )}
        <span className="text-xs text-white/60">
          {index + 1} / {results.length}
        </span>
      </div>
    </div>
  );
}
