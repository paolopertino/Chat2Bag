import { Crosshair, Flame, Pencil } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLocation, useParams, useSearchParams } from "react-router-dom";

import { getBagInfo } from "../api/client";
import type { SearchResult } from "../api/types";
import { ExtractDialog } from "../components/extract/extract-dialog";
import { Omnibox } from "../components/omnibox/omnibox";
import { ResultsRail } from "../components/search/results-rail";
import { SampleGridViewer } from "../components/samples/sample-grid-viewer";
import { TimelineBar } from "../components/samples/timeline-bar";
import { useJobs } from "../context/jobs-context";
import { useHeatmaps } from "../hooks/use-heatmaps";
import { useOmniboxSearch } from "../hooks/use-omnibox-search";
import { useSampleBrowser } from "../hooks/use-sample-browser";
import { decodeBagId } from "../lib/bag-id";
import { DEFAULT_WINDOW_S, clampWindow, formatWindowTime, windowLengthS } from "../lib/extraction-window";
import { framesFromSample } from "../lib/region-support";

export function BagViewerPage() {
  const { bagId } = useParams();
  const [params] = useSearchParams();
  const location = useLocation();
  const browser = useSampleBrowser();
  const [editMode, setEditMode] = useState(false);
  const [bagRange, setBagRange] = useState<{ first: number; last: number } | null>(null);
  const [extractWindow, setExtractWindow] = useState<{ startNs: number; endNs: number } | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [draftWindow, setDraftWindow] = useState<{ startNs: number; endNs: number } | null>(null);
  const [supportDialogOpen, setSupportDialogOpen] = useState(false);
  const [showHeatmaps, setShowHeatmaps] = useState(false);

  const bagPath = useMemo(() => (bagId ? decodeBagId(bagId) : null), [bagId]);
  const bagName = bagPath ? bagPath.replace(/\/+$/, "").split("/").pop()! : "";

  const search = useOmniboxSearch({ scope: { bagPaths: bagPath ? [bagPath] : [] } });
  const { extractionEnabled } = useJobs();
  const regionActive = search.activeKind === "region";

  // Region heatmaps for the frames currently shown (the timeline's active sample).
  const visibleFilePaths = useMemo(
    () =>
      browser.activeSample
        ? Object.values(browser.activeSample.frames_by_camera).map((f) => f.file_path)
        : [],
    [browser.activeSample],
  );
  const heatmaps = useHeatmaps(
    visibleFilePaths,
    regionActive ? search.fetchHeatmap : undefined,
    showHeatmaps,
  );

  const handedResults = (location.state as { results?: SearchResult[] } | null)?.results ?? [];
  const pins = [...handedResults.filter((r) => r.bag_path === bagPath), ...search.results];

  function useSampleAsRegionSupport() {
    const sample = browser.activeSample;
    if (!sample) return;
    const { frames, defaultSelected } = framesFromSample(browser.cameras, sample);
    if (frames.length === 0) return;
    search.setSupport({ kind: "frame", filePath: defaultSelected, frames });
    setSupportDialogOpen(true);
  }

  useEffect(() => {
    if (!bagPath) return;
    void (async () => {
      const info = await getBagInfo(bagPath);
      const firstNs = info.first_timestamp_ns ?? 0;
      const lastNs = info.last_timestamp_ns ?? 0;
      setBagRange({ first: firstNs, last: lastNs });
      const t = params.get("t");
      await browser.openForBag({
        bagPath,
        bagName,
        startNs: t !== null ? Number(t) : firstNs,
      });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bagPath]);

  // Keyboard navigation
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowLeft") void browser.selectPreviousSample();
      else if (e.key === "ArrowRight") void browser.selectNextSample();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [browser.selectPreviousSample, browser.selectNextSample]);

  useEffect(() => {
    if (!selectMode) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setSelectMode(false);
        setDraftWindow(null);
      } else if (e.key === "Enter" && draftWindow && draftWindow.endNs > draftWindow.startNs) {
        setExtractWindow(draftWindow);
        setSelectMode(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectMode, draftWindow]);

  if (!bagPath) return null;

  return (
    <div className="absolute inset-0 flex flex-col gap-2 p-3">
      <div className="flex items-center gap-2 pr-44">
        <h1 className="shrink-0 truncate text-sm font-semibold">{bagName}</h1>
        <Omnibox
          search={search}
          showAreaChip={false}
          className="min-w-0 flex-1"
          supportDialogOpen={supportDialogOpen}
          onSupportDialogOpenChange={setSupportDialogOpen}
        />
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <button
            className="flex items-center gap-1 rounded border border-[var(--line)] px-2 py-1 text-xs disabled:opacity-40"
            onClick={useSampleAsRegionSupport}
            disabled={!browser.activeSample}
            title="Pick a camera frame to place region prompts on"
          >
            <Crosshair className="h-3 w-3" /> Region support
          </button>
          {regionActive ? (
            <button
              className={
                "flex items-center gap-1 rounded border px-2 py-1 text-xs " +
                (showHeatmaps ? "border-[var(--teal)] bg-[rgb(var(--teal-rgb)/0.2)]" : "border-[var(--line)]")
              }
              onClick={() => setShowHeatmaps((v) => !v)}
              title="Toggle the region-match heatmap on the frames"
            >
              <Flame className="h-3 w-3" /> Heatmap
            </button>
          ) : null}
          <button
            className="flex items-center gap-1 rounded border border-[var(--line)] px-2 py-1 text-xs disabled:opacity-40"
            disabled={!extractionEnabled || !bagRange}
            title={!extractionEnabled ? "Extraction service offline" : undefined}
            onClick={() => {
              if (!bagRange) return;
              const center = browser.activeSample?.timestamp_ns ?? bagRange.first;
              setDraftWindow(
                clampWindow(
                  { startNs: center, endNs: center + DEFAULT_WINDOW_S * 1e9 },
                  bagRange.first,
                  bagRange.last,
                ),
              );
              setSelectMode(true);
            }}
          >
            Extract…
          </button>
          <button
            className={
              "flex items-center gap-1 rounded border px-2 py-1 text-xs " +
              (editMode ? "border-sky-400 bg-sky-400/15" : "border-[var(--line)]")
            }
            onClick={() => setEditMode(!editMode)}
          >
            <Pencil className="h-3 w-3" /> layout
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        <SampleGridViewer
          cameras={browser.cameras}
          sample={browser.activeSample}
          editMode={editMode}
          heatmaps={heatmaps}
          showHeatmaps={showHeatmaps}
        />
      </div>

      {search.results.length > 0 ? (
        <ResultsRail
          results={search.results}
          selectedIndex={null}
          onSelect={(i) => {
            const r = search.results[i];
            if (r) void browser.jumpToTimestamp(r.timestamp_ns);
          }}
          onLoadMore={search.loadMore}
          isSearching={search.isSearching}
          className="max-h-24"
        />
      ) : null}

      {selectMode && draftWindow && bagRange ? (
        <div className="flex items-center gap-2 text-xs">
          <span className="opacity-70">
            {formatWindowTime(draftWindow.startNs, bagRange.first)} →{" "}
            {formatWindowTime(draftWindow.endNs, bagRange.first)} · {windowLengthS(draftWindow).toFixed(1)}s
          </span>
          <button
            className="rounded bg-sky-500/80 px-2 py-0.5 disabled:opacity-50"
            disabled={draftWindow.endNs <= draftWindow.startNs}
            onClick={() => {
              setExtractWindow(draftWindow);
              setSelectMode(false);
            }}
          >
            Extract this window
          </button>
          <button
            className="rounded border border-[var(--line)] px-2 py-0.5"
            onClick={() => {
              setSelectMode(false);
              setDraftWindow(null);
            }}
          >
            cancel
          </button>
          <span className="opacity-50">drag on the timeline to adjust</span>
        </div>
      ) : null}

      {bagRange ? (
        <TimelineBar
          samples={browser.samples}
          selectedIndex={browser.selectedSampleIndex}
          firstNs={bagRange.first}
          lastNs={bagRange.last}
          pins={pins}
          onSelectSample={(i) => {
            const s = browser.samples[i];
            if (s) browser.setSelectedTimestampNs(s.timestamp_ns);
          }}
          onPinClick={(pin) => void browser.jumpToTimestamp(pin.timestamp_ns)}
          onLoadLeft={() => void browser.loadMoreLeft()}
          onLoadRight={() => void browser.loadMoreRight()}
          canLoadLeft={browser.canLoadMoreLeft}
          canLoadRight={browser.canLoadMoreRight}
          selectMode={selectMode}
          selectedWindow={draftWindow}
          onWindowChange={(startNs, endNs) => setDraftWindow({ startNs, endNs })}
        />
      ) : null}

      {extractWindow && bagRange ? (
        <ExtractDialog
          bagPath={bagPath}
          bagName={bagName}
          firstNs={bagRange.first}
          lastNs={bagRange.last}
          initialWindow={extractWindow}
          open
          onOpenChange={(o) => {
            if (!o) setExtractWindow(null);
          }}
        />
      ) : null}
    </div>
  );
}
