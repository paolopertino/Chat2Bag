import { ArrowLeft, Crosshair, Download, LoaderCircle, MessageSquare, MessageSquareOff } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useOutletContext, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { getBagInfo, getBagStatus } from "../../api/client";
import type { BagInfo, BagInfoResponse } from "../../api/types";
import { BagRootChip } from "../../components/bags/bag-root-chip";
import { BagSequenceViewer } from "../../components/bags/bag-sequence-viewer";
import { BagTree } from "../../components/bags/bag-tree";
import { PinRail } from "../../components/bags/pin-rail";
import { ExtractDatasetDialog } from "../../components/extraction/extract-dataset-dialog";
import { useSidebar } from "../../components/layout/sidebar-slot";
import { FilterChip } from "../../components/search/filter-chip";
import { SearchInput } from "../../components/search/search-input";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { useJobs } from "../../context/jobs-context";
import { useExtractionLauncher } from "../../hooks/use-extraction-launcher";
import { usePins } from "../../hooks/use-pins";
import { useSequenceViewer } from "../../hooks/use-sequence-viewer";
import { useUrlSearch } from "../../hooks/use-url-search";
import { decodeBagId } from "../../lib/bag-id";
import type { BagsOutletContext } from "./bags-layout";

function useDecodedBagPath(): { bagPath: string | null; error: string | null } {
  const { bagId } = useParams<{ bagId: string }>();
  return useMemo(() => {
    if (!bagId) return { bagPath: null, error: "Missing bag id" };
    try {
      return { bagPath: decodeBagId(bagId), error: null };
    } catch {
      return { bagPath: null, error: "Invalid bag id" };
    }
  }, [bagId]);
}

export function BagDetailPage() {
  const ctx = useOutletContext<BagsOutletContext>();
  const {
    rootDir,
    setRootDir,
    bags,
    isScanning,
    onScan,
    onIndex,
    registerBag,
    unregisterBag,
  } = ctx;
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { bagPath, error: decodeError } = useDecodedBagPath();
  const { schema, extractionEnabled, refresh } = useJobs();

  const [directLoadedBag, setDirectLoadedBag] = useState<BagInfo | null>(null);
  const [bagInfoState, setBagInfoState] = useState<{
    bagPath: string;
    info: BagInfoResponse | null;
  } | null>(null);
  const [loadErrorState, setLoadErrorState] = useState<{
    bagPath: string;
    message: string;
  } | null>(null);
  const syntheticBagPathRef = useRef<string | null>(null);
  const viewerOpenedRef = useRef<string | null>(null);

  const viewerState = useSequenceViewer();
  const launcher = useExtractionLauncher(schema, refresh);
  const [chatOpen, setChatOpen] = useState(false);

  const searchScope = useMemo(
    () => ({ bagPaths: bagPath ? [bagPath] : [] }),
    [bagPath],
  );
  const search = useUrlSearch({ scope: searchScope, topKDefault: 100 });
  const [searchDraft, setSearchDraft] = useState(search.q);
  useEffect(() => {
    // Sync draft when URL q changes externally (browser Back/Forward).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSearchDraft(search.q);
  }, [search.q]);

  const pins = usePins(bagPath, search.results, search.minScore);

  const highlightedTimestamps = useMemo(() => {
    const map = new Map<number, number>();
    for (const p of pins) {
      if (p.score !== undefined) map.set(p.timestamp_ns, p.score);
    }
    return map;
  }, [pins]);

  const [viewportRange, setViewportRange] = useState<{ start: number | null; end: number | null }>({
    start: null,
    end: null,
  });

  const handleViewportChange = useCallback((start: number | null, end: number | null) => {
    setViewportRange({ start, end });
  }, []);

  const resolvedBag =
    bags.find((b) => b.bag_path === bagPath) ??
    (directLoadedBag?.bag_path === bagPath ? directLoadedBag : null);
  const bagInfo = bagInfoState?.bagPath === bagPath ? bagInfoState.info : null;
  const loadError = loadErrorState?.bagPath === bagPath ? loadErrorState.message : null;

  // Resolve bag record (from scan state, or via /api/bags/status).
  useEffect(() => {
    if (!bagPath) return;
    const fromState = bags.find((b) => b.bag_path === bagPath);
    if (fromState) {
      if (syntheticBagPathRef.current === bagPath) {
        syntheticBagPathRef.current = null;
      }
      return;
    }

    let cancelled = false;
    getBagStatus(bagPath)
      .then((resp) => {
        if (cancelled) return;
        const bag: BagInfo = {
          bag_path: resp.bag_path,
          bag_name: resp.bag_path.split("/").filter(Boolean).pop() ?? resp.bag_path,
          is_indexed: resp.status === "done",
          status: resp.status,
          error_message: resp.error_message ?? null,
        };
        setDirectLoadedBag(bag);
        registerBag(bag);
        syntheticBagPathRef.current = bag.bag_path;
        setLoadErrorState(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadErrorState({
          bagPath,
          message: err instanceof Error ? err.message : "Failed to load bag.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [bagPath, bags, registerBag]);

  // Clean up synthetic bag registration on unmount.
  useEffect(() => {
    if (!bagPath) return;
    return () => {
      if (syntheticBagPathRef.current === bagPath) {
        unregisterBag(bagPath);
        syntheticBagPathRef.current = null;
      }
    };
  }, [bagPath, unregisterBag]);

  // Fetch bag info once the bag is indexed.
  useEffect(() => {
    if (!bagPath || !resolvedBag || !resolvedBag.is_indexed) return;

    let cancelled = false;
    getBagInfo(bagPath)
      .then((info) => {
        if (!cancelled) {
          setBagInfoState({ bagPath, info });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBagInfoState({ bagPath, info: null });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [bagPath, resolvedBag]);

  // Open the viewer once per bag, at ?t=<ns> or at the first-frame timestamp.
  useEffect(() => {
    if (!bagPath || !resolvedBag || !resolvedBag.is_indexed) return;
    if (!bagInfo || bagInfo.frame_count === 0 || bagInfo.first_timestamp_ns === null) return;

    const tParam = searchParams.get("t");
    const requestedTs = tParam ? Number(tParam) : NaN;
    const withinRange =
      Number.isFinite(requestedTs) &&
      bagInfo.first_timestamp_ns !== null &&
      bagInfo.last_timestamp_ns !== null &&
      requestedTs >= bagInfo.first_timestamp_ns &&
      requestedTs <= bagInfo.last_timestamp_ns;
    const startNs = withinRange ? requestedTs : bagInfo.first_timestamp_ns;

    if (tParam && !withinRange) {
      toast.error("Requested timestamp is out of range; showing bag start.");
    }

    const viewerOpenKey = `${bagPath}:${startNs}`;
    if (viewerOpenedRef.current === viewerOpenKey) return;

    viewerOpenedRef.current = viewerOpenKey;
    void viewerState.openViewerForBag({
      bagPath,
      bagName: resolvedBag.bag_name,
      startNs,
    });
  }, [bagPath, resolvedBag, bagInfo, searchParams, viewerState]);

  useSidebar(
    () => (
      <div className="space-y-3">
        <BagRootChip
          rootDir={rootDir}
          onRootDirChange={setRootDir}
          onScan={onScan}
          isScanning={isScanning}
        />
        <BagTree bags={bags} selectedBagPath={bagPath} onIndex={onIndex} compact />
      </div>
    ),
    [rootDir, setRootDir, onScan, isScanning, bags, bagPath, onIndex],
  );

  const handleExtractDataset = () => {
    if (!resolvedBag || viewerState.selectedTimestampNs === null) return;
    launcher.open({
      bagPath: resolvedBag.bag_path,
      centerNs: viewerState.selectedTimestampNs,
      defaultWindowS: viewerState.chatDuration,
    });
  };

  const { q: searchQ, similar: searchSimilar, clear: searchClear } = search;
  const {
    selectedTimestampNs: viewerSelectedTs,
    jumpToTimestamp: viewerJumpTo,
  } = viewerState;

  useEffect(() => {
    if (!resolvedBag) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const isEditing = tag === "INPUT" || tag === "TEXTAREA";

      if (e.key === "Escape" && !isEditing && (searchQ || searchSimilar)) {
        e.preventDefault();
        setSearchDraft("");
        searchClear();
        return;
      }

      if (isEditing) return;
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      if (pins.length === 0) return;
      e.preventDefault();

      const currentTs = viewerSelectedTs;
      let next: number;
      if (currentTs === null) {
        next =
          e.key === "ArrowDown"
            ? pins[0].timestamp_ns
            : pins[pins.length - 1].timestamp_ns;
      } else {
        const idx = pins.findIndex((p) => p.timestamp_ns === currentTs);
        const fallback = pins.findIndex((p) => p.timestamp_ns > currentTs);
        const baseIdx = idx >= 0 ? idx : fallback >= 0 ? fallback - 1 : pins.length - 1;
        const targetIdx =
          e.key === "ArrowDown"
            ? Math.min(pins.length - 1, baseIdx + 1)
            : Math.max(0, baseIdx - 1);
        next = pins[targetIdx].timestamp_ns;
      }
      void viewerJumpTo(next);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pins, viewerSelectedTs, viewerJumpTo, resolvedBag, searchQ, searchSimilar, searchClear]);

  if (decodeError) {
    return (
      <div className="rounded-md border border-dashed border-[var(--border)] bg-[var(--surface)] p-8 text-center">
        <h2 className="text-base font-semibold">Bag not found</h2>
        <p className="mt-1 text-sm text-[var(--ink-soft)]">{decodeError}</p>
        <Button asChild variant="outline" className="mt-4">
          <Link to="/bags">
            <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
            Back to bags
          </Link>
        </Button>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="rounded-md border border-dashed border-[var(--border)] bg-[var(--surface)] p-8 text-center">
        <h2 className="text-base font-semibold">Bag not found</h2>
        <p className="mt-1 font-mono text-xs text-[var(--ink-soft)]">{bagPath}</p>
        <p className="mt-2 text-sm text-[var(--ink-soft)]">{loadError}</p>
        <Button asChild variant="outline" className="mt-4">
          <Link to="/bags">
            <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
            Back to bags
          </Link>
        </Button>
      </div>
    );
  }

  if (!resolvedBag) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <LoaderCircle className="h-6 w-6 animate-spin text-[var(--ink-soft)]" />
      </div>
    );
  }

  if (!resolvedBag.is_indexed) {
    const isIndexing = resolvedBag.status === "indexing";
    const indexingError = resolvedBag.status === "error" ? resolvedBag.error_message : null;
    return (
      <div className="rounded-md border border-dashed border-[var(--border)] bg-[var(--surface)] p-8 text-center">
        <h2 className="text-base font-semibold">
          {indexingError ? "This bag failed to index." : "This bag isn't indexed yet."}
        </h2>
        <p className="mt-1 font-mono text-xs text-[var(--ink-soft)]">{resolvedBag.bag_path}</p>
        {indexingError ? (
          <p className="mt-2 text-sm text-[var(--ink-soft)]">{indexingError}</p>
        ) : null}
        <Button
          onClick={() => onIndex(resolvedBag.bag_path)}
          disabled={isIndexing}
          className="mt-4"
        >
          {isIndexing ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : null}
          {isIndexing ? "Indexing" : "Index"}
        </Button>
      </div>
    );
  }

  const headerSlot = (
    <div className="flex items-center gap-2 border-b border-[var(--line)] px-3 py-2">
      <div className="flex flex-shrink-0 items-center gap-2">
        <Link
          to="/bags"
          className="text-[var(--ink-soft)] hover:text-[var(--ink)]"
          aria-label="Back to bags"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <span className="font-mono text-xs">{resolvedBag.bag_name}</span>
        <Badge variant={resolvedBag.is_indexed ? "default" : "outline"} className="text-[10px]">
          {resolvedBag.status}
        </Badge>
      </div>
      <div
        className="flex-1"
        title={!resolvedBag.is_indexed ? "Index this bag to enable search." : undefined}
      >
        <SearchInput
          value={searchDraft}
          placeholder="Find in this bag…"
          disabled={!resolvedBag.is_indexed}
          onChange={setSearchDraft}
          onSubmit={(text) => search.submitText(text)}
          onClear={() => {
            setSearchDraft("");
            search.clear();
          }}
          onImageUpload={(file) => void search.submitImage(file)}
        />
      </div>
      <div className="flex flex-shrink-0 items-center gap-2">
        {viewerState.activeFrame?.file_path ? (
          <Button
            variant="outline"
            size="sm"
            title="Use this frame as a region-search support image"
            onClick={() =>
              navigate(
                `/search?mode=region&support=${encodeURIComponent(viewerState.activeFrame!.file_path)}`,
              )
            }
          >
            <Crosshair className="mr-1.5 h-3.5 w-3.5" />
            Search region
          </Button>
        ) : null}
        {extractionEnabled ? (
          <Button variant="outline" size="sm" onClick={handleExtractDataset}>
            <Download className="mr-1.5 h-3.5 w-3.5" />
            Extract dataset
          </Button>
        ) : null}
        <Button
          variant={chatOpen ? "default" : "outline"}
          size="sm"
          onClick={() => setChatOpen((v) => !v)}
        >
          {chatOpen ? (
            <MessageSquareOff className="mr-1.5 h-3.5 w-3.5" />
          ) : (
            <MessageSquare className="mr-1.5 h-3.5 w-3.5" />
          )}
          Chat
        </Button>
      </div>
    </div>
  );

  const hiddenPinCount = search.rawResultCount - search.results.length;
  // Image search populates results without setting q/similar (it never touches the
  // URL), so also show the rail when there are raw results — otherwise image-search
  // pins stay hidden while text-search pins show.
  const pinRail =
    search.q || search.similar || search.rawResultCount > 0 ? (
      <div className="space-y-2">
        <FilterChip
          topK={search.topK}
          minScore={search.minScore}
          rawResultCount={search.rawResultCount}
          bagCount={1}
          showTopK={false}
          onTopKChange={search.setTopK}
          onMinScoreChange={search.setMinScore}
        />
        <PinRail
          pins={pins}
          bagStartNs={bagInfo?.first_timestamp_ns ?? null}
          bagEndNs={bagInfo?.last_timestamp_ns ?? null}
          viewportStartNs={viewportRange.start}
          viewportEndNs={viewportRange.end}
          selectedTimestampNs={viewerState.selectedTimestampNs}
          onPinClick={(ns) => void viewerState.jumpToTimestamp(ns)}
        />
        {pins.length === 0 && hiddenPinCount > 0 ? (
          <p className="text-xs text-[var(--ink-soft)]">
            0 visible / {hiddenPinCount} hit{hiddenPinCount === 1 ? "" : "s"} below threshold ·{" "}
            <button
              type="button"
              className="text-[var(--teal)] hover:underline"
              onClick={() => search.setMinScore(0)}
            >
              Lower the threshold
            </button>
          </p>
        ) : null}
      </div>
    ) : null;

  return (
    <>
      <BagSequenceViewer
        result={viewerState.selectedResult}
        activeFrame={viewerState.activeFrame}
        frames={viewerState.frames}
        selectedTimestampNs={viewerState.selectedTimestampNs}
        selectedFrameIndex={viewerState.selectedFrameIndex}
        isLoadingFrames={viewerState.isLoadingFrames}
        canLoadMoreLeft={viewerState.canLoadMoreLeft}
        canLoadMoreRight={viewerState.canLoadMoreRight}
        isExtendingLeft={viewerState.isExtendingLeft}
        isExtendingRight={viewerState.isExtendingRight}
        chatDuration={viewerState.chatDuration}
        chatQuery={viewerState.chatQuery}
        chatResponse={viewerState.chatResponse}
        isChatting={viewerState.isChatting}
        extractionEnabled={extractionEnabled}
        vlmWindowStartNs={viewerState.vlmWindowStartNs}
        vlmWindowEndNs={viewerState.vlmWindowEndNs}
        isFrameInVlmWindow={viewerState.isFrameInVlmWindow}
        onSelectTimestamp={viewerState.setSelectedTimestampNs}
        onSelectNextFrame={viewerState.selectNextFrame}
        onSelectPreviousFrame={viewerState.selectPreviousFrame}
        onLoadMoreLeft={() => void viewerState.loadMoreLeft()}
        onLoadMoreRight={() => void viewerState.loadMoreRight()}
        onChatQueryChange={viewerState.setChatQuery}
        onChatDurationChange={viewerState.setChatDuration}
        onChat={() => void viewerState.runChat()}
        onExtractDataset={handleExtractDataset}
        headerSlot={headerSlot}
        pinRail={pinRail}
        highlightedTimestamps={highlightedTimestamps}
        onViewportChange={handleViewportChange}
        chatOpen={chatOpen}
        onChatOpenChange={setChatOpen}
      />
      {extractionEnabled ? (
        <ExtractDatasetDialog
          isOpen={launcher.isOpen}
          isSubmitting={launcher.isSubmitting}
          schema={schema}
          bagName={resolvedBag.bag_name}
          bagPath={launcher.bagPath}
          centerTimestampMs={
            viewerState.selectedTimestampNs !== null
              ? Math.floor(viewerState.selectedTimestampNs / 1_000_000)
              : 0
          }
          windowS={launcher.windowS}
          outputFolder={launcher.outputFolder}
          userConfig={launcher.userConfig}
          onClose={launcher.close}
          onSubmit={() => void launcher.submit()}
          onBagPathChange={launcher.setBagPath}
          onWindowChange={launcher.setWindowS}
          onOutputFolderChange={launcher.setOutputFolder}
          onFieldChange={launcher.setFieldValue}
        />
      ) : null}
    </>
  );
}
