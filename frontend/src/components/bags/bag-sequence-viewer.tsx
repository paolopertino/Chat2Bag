import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Download,
  LoaderCircle,
  MessageSquare,
  MessageSquareOff,
} from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import type { FrameInfo, SearchResult } from "../../api/types";
import { AuthImage } from "../ui/auth-image";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";

interface BagSequenceViewerProps {
  result: SearchResult | null;
  activeFrame: FrameInfo | null;
  frames: FrameInfo[];
  selectedTimestampNs: number | null;
  selectedFrameIndex: number;
  isLoadingFrames: boolean;
  canLoadMoreLeft: boolean;
  canLoadMoreRight: boolean;
  isExtendingLeft: boolean;
  isExtendingRight: boolean;
  chatDuration: number;
  chatQuery: string;
  chatResponse: string | null;
  isChatting: boolean;
  extractionEnabled: boolean;
  vlmWindowStartNs: number | null;
  vlmWindowEndNs: number | null;
  isFrameInVlmWindow: (timestampNs: number) => boolean;
  onSelectTimestamp: (ns: number) => void;
  onSelectNextFrame: () => void;
  onSelectPreviousFrame: () => void;
  onLoadMoreLeft: () => void;
  onLoadMoreRight: () => void;
  onChatQueryChange: (value: string) => void;
  onChatDurationChange: (value: number) => void;
  onChat: () => void;
  onExtractDataset: () => void;
  /** Optional override for the page header. When provided, replaces the default bag-name header. */
  headerSlot?: ReactNode;
  /** Optional rail rendered above the thumbnail strip. */
  pinRail?: ReactNode;
  /** Map of timestamp_ns → score; matching thumbnails render with an orange outline + score badge. */
  highlightedTimestamps?: Map<number, number>;
  /** Called when the visible thumbnail range changes due to scroll. */
  onViewportChange?: (startNs: number | null, endNs: number | null) => void;
  /** Controlled chat panel open state. When provided, parent owns the toggle. */
  chatOpen?: boolean;
  onChatOpenChange?: (open: boolean) => void;
}

function formatTimestamp(ns: number | null): string {
  if (ns === null) return "—";
  const seconds = ns / 1_000_000_000;
  return `${seconds.toFixed(3)} s (${ns})`;
}

export function BagSequenceViewer({
  result,
  activeFrame,
  frames,
  selectedTimestampNs,
  selectedFrameIndex,
  isLoadingFrames,
  canLoadMoreLeft,
  canLoadMoreRight,
  isExtendingLeft,
  isExtendingRight,
  chatDuration,
  chatQuery,
  chatResponse,
  isChatting,
  extractionEnabled,
  vlmWindowStartNs,
  vlmWindowEndNs,
  isFrameInVlmWindow,
  onSelectTimestamp,
  onSelectNextFrame,
  onSelectPreviousFrame,
  onLoadMoreLeft,
  onLoadMoreRight,
  onChatQueryChange,
  onChatDurationChange,
  onChat,
  onExtractDataset,
  headerSlot,
  pinRail,
  highlightedTimestamps,
  onViewportChange,
  chatOpen: chatOpenProp,
  onChatOpenChange,
}: BagSequenceViewerProps) {
  const [chatOpenLocal, setChatOpenLocal] = useState(false);
  const chatOpen = chatOpenProp !== undefined ? chatOpenProp : chatOpenLocal;
  const setChatOpen = (v: boolean) => {
    if (onChatOpenChange) onChatOpenChange(v);
    else setChatOpenLocal(v);
  };
  const chatPanelId = useId();
  const chatDurationId = useId();
  const chatQueryId = useId();
  const frameRefs = useRef<Record<number, HTMLButtonElement | null>>({});
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const stripRef = useRef<HTMLDivElement | null>(null);

  const computeViewport = useCallback(() => {
    const strip = stripRef.current;
    if (!strip || frames.length === 0) {
      onViewportChange?.(null, null);
      return;
    }
    const { scrollLeft, clientWidth } = strip;
    const scrollRight = scrollLeft + clientWidth;
    let firstVisible: number | null = null;
    let lastVisible: number | null = null;
    for (const frame of frames) {
      const el = frameRefs.current[frame.timestamp_ns];
      if (!el) continue;
      const { offsetLeft, offsetWidth } = el;
      if (offsetLeft + offsetWidth > scrollLeft && offsetLeft < scrollRight) {
        if (firstVisible === null) firstVisible = frame.timestamp_ns;
        lastVisible = frame.timestamp_ns;
      }
    }
    onViewportChange?.(firstVisible, lastVisible);
  }, [frames, onViewportChange]);

  useEffect(() => {
    computeViewport();
  }, [computeViewport]);

  useEffect(() => {
    if (!result) {
      return;
    }
    viewerRef.current?.focus();
  }, [result]);

  useEffect(() => {
    if (selectedTimestampNs === null) {
      return;
    }

    frameRefs.current[selectedTimestampNs]?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "center",
    });
  }, [frames, selectedTimestampNs]);

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
      onSelectPreviousFrame();
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      onSelectNextFrame();
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
            <Button asChild variant="ghost" size="sm">
              <Link to="/bags">
                <ArrowLeft className="mr-1 h-3.5 w-3.5" />
                Bags
              </Link>
            </Button>
            <span className="truncate text-sm font-semibold">{result.source_bag}</span>
            <span className="text-xs text-[var(--ink-soft)]">
              {formatTimestamp(selectedTimestampNs)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {extractionEnabled ? (
              <Button variant="outline" size="sm" onClick={onExtractDataset}>
                <Download className="mr-1.5 h-3.5 w-3.5" />
                Extract dataset
              </Button>
            ) : null}
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
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 items-center justify-center bg-black/90 p-3">
            {isLoadingFrames ? (
              <LoaderCircle className="h-8 w-8 animate-spin text-white/70" />
            ) : activeFrame ? (
              <AuthImage
                key={activeFrame.file_path}
                filePath={activeFrame.file_path}
                alt={`Frame ${activeFrame.timestamp_ns}`}
                className="max-h-full max-w-full object-contain"
              />
            ) : (
              <p className="text-sm text-white/70">No frame available.</p>
            )}
          </div>

          {pinRail ? <div className="border-t border-[var(--line)] px-3 pt-2">{pinRail}</div> : null}
          <div className="flex items-center gap-2 border-t border-[var(--line)] bg-[var(--surface)] px-3 py-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={!canLoadMoreLeft || isExtendingLeft}
              onClick={onLoadMoreLeft}
              aria-label="Load older frames"
              title="Load older frames"
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
              onClick={onSelectPreviousFrame}
              disabled={selectedFrameIndex <= 0 && !canLoadMoreLeft}
              aria-label="Previous frame"
              title="Previous frame (←)"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div ref={stripRef} className="flex flex-1 gap-1 overflow-x-auto" onScroll={computeViewport}>
              {frames.map((frame) => {
                const selected = frame.timestamp_ns === selectedTimestampNs;
                const inWindow = isFrameInVlmWindow(frame.timestamp_ns);
                const isHighlighted = highlightedTimestamps?.has(frame.timestamp_ns) ?? false;
                const score = highlightedTimestamps?.get(frame.timestamp_ns);
                return (
                  <button
                    key={frame.timestamp_ns}
                    ref={(node) => {
                      frameRefs.current[frame.timestamp_ns] = node;
                    }}
                    type="button"
                    onClick={() => onSelectTimestamp(frame.timestamp_ns)}
                    aria-pressed={selected}
                    aria-label={`Frame at ${formatTimestamp(frame.timestamp_ns)}`}
                    className={`relative shrink-0 overflow-hidden rounded border-2 ${
                      selected
                        ? "border-[var(--teal)]"
                        : inWindow
                          ? "border-[var(--teal)]/40"
                          : "border-transparent"
                    } ${isHighlighted ? "ring-2 ring-[#f59e0b] ring-offset-1" : ""}`}
                    title={String(frame.timestamp_ns)}
                  >
                    <AuthImage
                      filePath={frame.file_path}
                      alt=""
                      className="h-14 w-24 object-cover"
                    />
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
              onClick={onSelectNextFrame}
              disabled={selectedFrameIndex === frames.length - 1 && !canLoadMoreRight}
              aria-label="Next frame"
              title="Next frame (→)"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={!canLoadMoreRight || isExtendingRight}
              onClick={onLoadMoreRight}
              aria-label="Load newer frames"
              title="Load newer frames"
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
              onChange={(e) => onChatDurationChange(Number(e.target.value) || 10)}
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
              onChange={(e) => onChatQueryChange(e.target.value)}
              placeholder="What does the camera see around this timestamp?"
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
