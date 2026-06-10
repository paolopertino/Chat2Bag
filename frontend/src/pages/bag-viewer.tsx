import { Pencil } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLocation, useParams, useSearchParams } from "react-router-dom";

import { getBagInfo } from "../api/client";
import type { SearchResult } from "../api/types";
import { ExtractDialog } from "../components/extract/extract-dialog";
import { Omnibox } from "../components/omnibox/omnibox";
import { ResultsRail } from "../components/search/results-rail";
import { SampleGridViewer } from "../components/samples/sample-grid-viewer";
import { TimelineBar } from "../components/samples/timeline-bar";
import { useOmniboxSearch } from "../hooks/use-omnibox-search";
import { useSampleBrowser } from "../hooks/use-sample-browser";
import { decodeBagId } from "../lib/bag-id";

export function BagViewerPage() {
  const { bagId } = useParams();
  const [params] = useSearchParams();
  const location = useLocation();
  const browser = useSampleBrowser();
  const [editMode, setEditMode] = useState(false);
  const [bagRange, setBagRange] = useState<{ first: number; last: number } | null>(null);
  const [extractTimestampNs, setExtractTimestampNs] = useState<number | null>(null);

  const bagPath = useMemo(() => (bagId ? decodeBagId(bagId) : null), [bagId]);
  const bagName = bagPath ? bagPath.replace(/\/+$/, "").split("/").pop()! : "";

  const search = useOmniboxSearch({ scope: { bagPaths: bagPath ? [bagPath] : [] } });

  const handedResults = (location.state as { results?: SearchResult[] } | null)?.results ?? [];
  const pins = [...handedResults.filter((r) => r.bag_path === bagPath), ...search.results];

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

  if (!bagPath) return null;

  return (
    <div className="absolute inset-0 flex flex-col gap-2 p-3">
      <div className="flex items-center gap-2">
        <h1 className="shrink-0 truncate text-sm font-semibold">{bagName}</h1>
        <Omnibox
          search={search}
          showAreaChip={false}
          showBagChip={false}
          className="w-[min(640px,80vw)]"
        />
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <button
            className="flex items-center gap-1 rounded border border-[var(--line)] px-2 py-1 text-xs"
            onClick={() =>
              setExtractTimestampNs(
                browser.activeSample?.timestamp_ns ?? bagRange?.first ?? 0,
              )
            }
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
        />
      ) : null}

      {extractTimestampNs !== null && bagPath ? (
        <ExtractDialog
          bagPath={bagPath}
          timestampNs={extractTimestampNs}
          open
          onOpenChange={(o) => { if (!o) setExtractTimestampNs(null); }}
        />
      ) : null}
    </div>
  );
}
