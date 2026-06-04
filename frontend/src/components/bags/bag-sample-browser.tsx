import {
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  MessageSquare,
  MessageSquareOff,
} from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";

import type { SampleInfo, SearchResult } from "../../api/types";
import { SampleViewer } from "../samples/sample-viewer";
import { AuthImage } from "../ui/auth-image";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";

interface BagSampleBrowserProps {
  result: SearchResult | null;
  activeSample: SampleInfo | null;
  samples: SampleInfo[];
  cameras: string[];
  selectedTimestampNs: number | null;
  selectedSampleIndex: number;
  isLoadingSamples: boolean;
  canLoadMoreLeft: boolean;
  canLoadMoreRight: boolean;
  isExtendingLeft: boolean;
  isExtendingRight: boolean;
  chatDuration: number;
  chatQuery: string;
  chatResponse: string | null;
  isChatting: boolean;
  vlmWindowStartNs: number | null;
  vlmWindowEndNs: number | null;
  isSampleInVlmWindow: (timestampNs: number) => boolean;
  onSelectTimestamp: (ns: number) => void;
  onSelectNextSample: () => void;
  onSelectPreviousSample: () => void;
  onLoadMoreLeft: () => void;
  onLoadMoreRight: () => void;
  onChatQueryChange: (value: string) => void;
  onChatDurationChange: (value: number) => void;
  onChat: () => void;
  headerSlot?: ReactNode;
  pinRail?: ReactNode;
  highlightedSampleTimestamps?: Map<number, number>;
  onViewportChange?: (startNs: number | null, endNs: number | null) => void;
  chatOpen?: boolean;
  onChatOpenChange?: (open: boolean) => void;
}

function formatTimestamp(ns: number | null): string {
  if (ns === null) return "-";
  const seconds = ns / 1_000_000_000;
  return `${seconds.toFixed(3)} s (${ns})`;
}

function coverage(sample: SampleInfo, cameraCount: number): string {
  return `${Object.keys(sample.frames_by_camera).length}/${cameraCount}`;
}

export function BagSampleBrowser({
  result,
  activeSample,
  samples,
  cameras,
  selectedTimestampNs,
  selectedSampleIndex,
  isLoadingSamples,
  canLoadMoreLeft,
  canLoadMoreRight,
  isExtendingLeft,
  isExtendingRight,
  chatDuration,
  chatQuery,
  chatResponse,
  isChatting,
  vlmWindowStartNs,
  vlmWindowEndNs,
  isSampleInVlmWindow,
  onSelectTimestamp,
  onSelectNextSample,
  onSelectPreviousSample,
  onLoadMoreLeft,
  onLoadMoreRight,
  onChatQueryChange,
  onChatDurationChange,
  onChat,
  headerSlot,
  pinRail,
  highlightedSampleTimestamps,
  onViewportChange,
  chatOpen: chatOpenProp,
  onChatOpenChange,
}: BagSampleBrowserProps) {
  const [chatOpenLocal, setChatOpenLocal] = useState(false);
  const chatOpen = chatOpenProp !== undefined ? chatOpenProp : chatOpenLocal;
  const setChatOpen = (value: boolean) => {
    if (onChatOpenChange) onChatOpenChange(value);
    else setChatOpenLocal(value);
  };
  const chatPanelId = useId();
  const chatDurationId = useId();
  const chatQueryId = useId();
  const sampleRefs = useRef<Record<number, HTMLButtonElement | null>>({});
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const stripRef = useRef<HTMLDivElement | null>(null);

  const computeViewport = useCallback(() => {
    const strip = stripRef.current;
    if (!strip || samples.length === 0) {
      onViewportChange?.(null, null);
      return;
    }
    const { scrollLeft, clientWidth } = strip;
    const scrollRight = scrollLeft + clientWidth;
    let firstVisible: number | null = null;
    let lastVisible: number | null = null;
    for (const sample of samples) {
      const el = sampleRefs.current[sample.timestamp_ns];
      if (!el) continue;
      const { offsetLeft, offsetWidth } = el;
      if (offsetLeft + offsetWidth > scrollLeft && offsetLeft < scrollRight) {
        if (firstVisible === null) firstVisible = sample.timestamp_ns;
        lastVisible = sample.timestamp_ns;
      }
    }
    onViewportChange?.(firstVisible, lastVisible);
  }, [samples, onViewportChange]);

  useEffect(() => {
    computeViewport();
  }, [computeViewport]);

  useEffect(() => {
    if (!result) return;
    viewerRef.current?.focus();
  }, [result]);

  useEffect(() => {
    if (selectedTimestampNs === null) return;
    sampleRefs.current[selectedTimestampNs]?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "center",
    });
  }, [samples, selectedTimestampNs]);

  if (!result) return null;

  const handleViewerKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.target instanceof HTMLElement) {
      const tag = event.target.tagName;
      if (
        event.target.isContentEditable ||
        tag === "INPUT" ||
        tag === "SELECT" ||
        tag === "TEXTAREA"
      ) {
        return;
      }
    }

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      onSelectPreviousSample();
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      onSelectNextSample();
    }
  };

  return (
    <div
      ref={viewerRef}
      tabIndex={0}
      onKeyDown={handleViewerKeyDown}
      className="flex h-[calc(100vh-9rem)] min-h-[520px] flex-col focus:outline-none"
    >
      {headerSlot ?? (
        <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] bg-[var(--surface)] px-4 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-semibold">{result.source_bag}</span>
            <span className="text-xs text-[var(--ink-soft)]">
              {formatTimestamp(selectedTimestampNs)}
            </span>
          </div>
          <Button
            variant={chatOpen ? "default" : "outline"}
            size="sm"
            onClick={() => setChatOpen(!chatOpen)}
            aria-controls={chatPanelId}
            aria-expanded={chatOpen}
          >
            {chatOpen ? (
              <MessageSquareOff className="mr-1.5 h-3.5 w-3.5" />
            ) : (
              <MessageSquare className="mr-1.5 h-3.5 w-3.5" />
            )}
            Chat
          </Button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 bg-black">
            <SampleViewer
              cameras={cameras}
              sample={activeSample}
              isLoading={isLoadingSamples}
              className="min-h-0 flex-1"
            />
          </div>

          {pinRail ? <div className="border-t border-[var(--line)] px-3 pt-2">{pinRail}</div> : null}
          <div className="flex items-center gap-2 border-t border-[var(--line)] bg-[var(--surface)] px-3 py-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={!canLoadMoreLeft || isExtendingLeft}
              onClick={onLoadMoreLeft}
              aria-label="Load older Samples"
              title="Load older Samples"
            >
              {isExtendingLeft ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <ChevronLeft className="h-4 w-4" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={onSelectPreviousSample}
              disabled={selectedSampleIndex <= 0 && !canLoadMoreLeft}
              aria-label="Previous Sample"
              title="Previous Sample (left arrow)"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div ref={stripRef} className="flex flex-1 gap-1 overflow-x-auto" onScroll={computeViewport}>
              {samples.map((sample) => {
                const selected = sample.timestamp_ns === selectedTimestampNs;
                const inWindow = isSampleInVlmWindow(sample.timestamp_ns);
                const anchorFrame = sample.anchor_frame;
                const isHighlighted = highlightedSampleTimestamps?.has(sample.timestamp_ns) ?? false;
                const score = highlightedSampleTimestamps?.get(sample.timestamp_ns);
                return (
                  <button
                    key={sample.timestamp_ns}
                    ref={(node) => {
                      sampleRefs.current[sample.timestamp_ns] = node;
                    }}
                    type="button"
                    onClick={() => onSelectTimestamp(sample.timestamp_ns)}
                    aria-pressed={selected}
                    aria-label={`Sample at ${formatTimestamp(sample.timestamp_ns)}`}
                    className={`relative h-14 w-24 shrink-0 overflow-hidden rounded border-2 ${
                      selected
                        ? "border-[var(--teal)]"
                        : inWindow
                          ? "border-[var(--teal)]/40"
                          : "border-transparent"
                    } ${isHighlighted ? "ring-2 ring-[#f59e0b] ring-offset-1" : ""}`}
                    title={String(sample.timestamp_ns)}
                  >
                    {anchorFrame ? (
                      <AuthImage
                        filePath={anchorFrame.file_path}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="h-full w-full bg-black" />
                    )}
                    <span className="absolute bottom-1 left-1 rounded-sm bg-black/70 px-1 text-[9px] font-semibold leading-none text-white">
                      {coverage(sample, cameras.length)}
                    </span>
                    {isHighlighted && score !== undefined ? (
                      <span className="absolute right-1 top-1 rounded-sm bg-[#16a085] px-1 text-[9px] font-semibold leading-none text-white">
                        {score.toFixed(2)}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={onSelectNextSample}
              disabled={selectedSampleIndex === samples.length - 1 && !canLoadMoreRight}
              aria-label="Next Sample"
              title="Next Sample (right arrow)"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={!canLoadMoreRight || isExtendingRight}
              onClick={onLoadMoreRight}
              aria-label="Load newer Samples"
              title="Load newer Samples"
            >
              {isExtendingRight ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>

        {chatOpen ? (
          <aside
            id={chatPanelId}
            className="flex w-[360px] shrink-0 flex-col gap-3 border-l border-[var(--line)] bg-[var(--surface)] p-3"
          >
            <h2 className="text-sm font-semibold">Ask the VLM</h2>
            {vlmWindowStartNs !== null && vlmWindowEndNs !== null ? (
              <p className="text-xs text-[var(--ink-soft)]">
                Window: {formatTimestamp(vlmWindowStartNs)} to {formatTimestamp(vlmWindowEndNs)}
              </p>
            ) : null}
            <label
              htmlFor={chatDurationId}
              className="text-xs font-medium uppercase tracking-[0.1em] text-[var(--ink-soft)]"
            >
              Window (seconds)
            </label>
            <Input
              id={chatDurationId}
              type="number"
              min={1}
              max={60}
              value={chatDuration}
              onChange={(event) => onChatDurationChange(Number(event.target.value) || 10)}
            />
            <label
              htmlFor={chatQueryId}
              className="text-xs font-medium uppercase tracking-[0.1em] text-[var(--ink-soft)]"
            >
              Question
            </label>
            <Textarea
              id={chatQueryId}
              rows={4}
              value={chatQuery}
              onChange={(event) => onChatQueryChange(event.target.value)}
              placeholder="What does the camera rig see around this Sample?"
            />
            <Button onClick={onChat} disabled={isChatting}>
              {isChatting ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : null}
              {isChatting ? "Asking" : "Ask"}
            </Button>
            {chatResponse ? (
              <div className="flex-1 overflow-auto rounded border border-[var(--line)] bg-white p-2 text-xs">
                {chatResponse}
              </div>
            ) : null}
          </aside>
        ) : null}
      </div>
    </div>
  );
}
