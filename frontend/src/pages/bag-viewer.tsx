import { Pencil } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLocation, useParams, useSearchParams } from "react-router-dom";

import { getBagInfo } from "../api/client";
import type { SearchResult } from "../api/types";
import { SampleGridViewer } from "../components/samples/sample-grid-viewer";
import { TimelineBar } from "../components/samples/timeline-bar";
import { useSampleBrowser } from "../hooks/use-sample-browser";
import { decodeBagId } from "../lib/bag-id";

export function BagViewerPage() {
  const { bagId } = useParams();
  const [params] = useSearchParams();
  const location = useLocation();
  const browser = useSampleBrowser();
  const [editMode, setEditMode] = useState(false);
  const [bagRange, setBagRange] = useState<{ first: number; last: number } | null>(null);

  const bagPath = useMemo(() => (bagId ? decodeBagId(bagId) : null), [bagId]);
  const bagName = bagPath ? bagPath.replace(/\/+$/, "").split("/").pop()! : "";

  const handedResults = (location.state as { results?: SearchResult[] } | null)?.results ?? [];
  const pins = handedResults.filter((r) => r.bag_path === bagPath);

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
      <div className="flex items-center justify-between">
        <h1 className="truncate text-sm font-semibold">{bagName}</h1>
        <div className="flex items-center gap-2">
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
    </div>
  );
}
