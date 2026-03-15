import { useEffect, useMemo, useRef } from "react";
import { LoaderCircle, MessageSquareText, X } from "lucide-react";

import { getImageUrl } from "../../api/client";
import type { FrameInfo, SearchResult } from "../../api/types";
import { Button } from "../ui/button";
import { Card, CardContent } from "../ui/card";
import { Input } from "../ui/input";

function formatTimestampNs(ns: number): string {
  const ms = Math.floor(ns / 1_000_000);
  return `${ms.toLocaleString()} ms`;
}

interface SequenceViewerProps {
  activeFrame: FrameInfo | null;
  canLoadMoreLeft: boolean;
  canLoadMoreRight: boolean;
  chatDuration: number;
  chatQuery: string;
  chatResponse: string | null;
  frames: FrameInfo[];
  isExtendingLeft: boolean;
  isExtendingRight: boolean;
  isChatting: boolean;
  isFrameInVlmWindow: (timestampNs: number) => boolean;
  isLoadingFrames: boolean;
  isOpen: boolean;
  onChat: () => void;
  onChatDurationChange: (value: number) => void;
  onChatQueryChange: (value: string) => void;
  onClose: () => void;
  onLoadMoreLeft: () => Promise<FrameInfo[] | null>;
  onLoadMoreRight: () => Promise<FrameInfo[] | null>;
  onSelectNextFrame: () => Promise<void>;
  onSelectPreviousFrame: () => Promise<void>;
  onSelectTimestamp: (timestampNs: number) => void;
  result: SearchResult | null;
  selectedFrameIndex: number;
  selectedTimestampNs: number | null;
  vlmWindowEndNs: number | null;
  vlmWindowStartNs: number | null;
}

export function SequenceViewer({
  activeFrame,
  canLoadMoreLeft,
  canLoadMoreRight,
  chatDuration,
  chatQuery,
  chatResponse,
  frames,
  isExtendingLeft,
  isExtendingRight,
  isChatting,
  isFrameInVlmWindow,
  isLoadingFrames,
  isOpen,
  onChat,
  onChatDurationChange,
  onChatQueryChange,
  onClose,
  onLoadMoreLeft,
  onLoadMoreRight,
  onSelectNextFrame,
  onSelectPreviousFrame,
  onSelectTimestamp,
  result,
  selectedFrameIndex,
  selectedTimestampNs,
  vlmWindowEndNs,
  vlmWindowStartNs,
}: SequenceViewerProps) {
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const frameRefs = useRef<Record<number, HTMLButtonElement | null>>({});

  const { firstWindowFrameTs, lastWindowFrameTs } = useMemo(() => {
    const windowFrames = frames.filter((frame) => isFrameInVlmWindow(frame.timestamp_ns));
    return {
      firstWindowFrameTs: windowFrames.length > 0 ? windowFrames[0].timestamp_ns : null,
      lastWindowFrameTs:
        windowFrames.length > 0 ? windowFrames[windowFrames.length - 1].timestamp_ns : null,
    };
  }, [frames, isFrameInVlmWindow]);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = async (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT")
      ) {
        return;
      }

      if (event.key === "Escape") {
        onClose();
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        await onSelectPreviousFrame();
        return;
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        await onSelectNextFrame();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen, onClose, onSelectNextFrame, onSelectPreviousFrame]);

  useEffect(() => {
    if (selectedTimestampNs === null) {
      return;
    }
    frameRefs.current[selectedTimestampNs]?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "center",
    });
  }, [selectedTimestampNs]);

  const handleTimelineScroll = async () => {
    const timeline = timelineRef.current;
    if (!timeline) {
      return;
    }

    const nearLeft = timeline.scrollLeft <= 40;
    const nearRight = timeline.scrollLeft + timeline.clientWidth >= timeline.scrollWidth - 40;

    if (nearLeft && canLoadMoreLeft && !isExtendingLeft && !isLoadingFrames) {
      await onLoadMoreLeft();
    }
    if (nearRight && canLoadMoreRight && !isExtendingRight && !isLoadingFrames) {
      await onLoadMoreRight();
    }
  };

  if (!isOpen || !result) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 bg-[rgba(17,19,21,0.68)] p-2 backdrop-blur-sm sm:p-4">
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
      <Card className="relative z-10 mx-auto flex h-[calc(100vh-1rem)] w-full max-w-6xl flex-col overflow-hidden bg-[var(--bg-paper)] sm:h-[calc(100vh-2rem)]">
        <div className="flex items-start justify-between gap-4 border-b border-[var(--line)] px-4 py-3 sm:px-5 sm:py-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--teal)]">Sequence Viewer</p>
            <h2 className="mt-1 truncate text-xl font-semibold sm:text-2xl">{result.source_bag}</h2>
            <p className="mt-1 truncate text-sm text-[var(--ink-soft)]">
              Selected frame at {formatTimestampNs(selectedTimestampNs ?? result.timestamp_ns)}
            </p>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={onClose} aria-label="Close viewer">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 sm:gap-4 sm:p-5">
          <div className="shrink-0 overflow-hidden rounded-2xl border border-[var(--line)] bg-white/80">
              {activeFrame ? (
                <img
                  src={getImageUrl(activeFrame.file_path)}
                  alt={`Sequence frame from ${result.source_bag}`}
                  className="h-[clamp(230px,44vh,470px)] w-full bg-[var(--bg-sand)] object-cover"
                />
              ) : (
                <div className="flex h-[clamp(230px,44vh,470px)] items-center justify-center text-sm text-[var(--ink-soft)]">
                  No frame selected.
                </div>
              )}
          </div>

          <div className="shrink-0 rounded-2xl border border-[var(--line)] bg-white/80 p-3 sm:p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold">Timeline</p>
                <p className="text-xs text-[var(--ink-soft)]">
                  Use keyboard arrows to move one frame at a time. Scroll to load older/newer chunks.
                </p>
                <p className="mt-1 text-xs text-[#8f5a11]">
                  Window selection: pick a center frame (teal), then set duration. Orange frames are sent to VLM.
                </p>
              </div>
              <div className="flex items-center gap-2 text-[var(--ink-soft)]">
                {isLoadingFrames || isExtendingLeft || isExtendingRight ? (
                  <LoaderCircle className="h-4 w-4 animate-spin text-[var(--teal)]" />
                ) : null}
              </div>
            </div>

            <div className="mb-3 rounded-lg border border-[var(--line)] bg-[var(--bg-paper)] px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs font-medium text-[var(--ink-soft)]">Duration: {chatDuration}s</p>
                <div className="flex items-center gap-2">
                  {[5, 10, 20, 30].map((preset) => (
                    <Button
                      key={preset}
                      type="button"
                      size="sm"
                      variant={chatDuration === preset ? "default" : "secondary"}
                      onClick={() => onChatDurationChange(preset)}
                      className="h-7 px-2.5 text-[11px]"
                    >
                      {preset}s
                    </Button>
                  ))}
                </div>
              </div>
              <input
                type="range"
                min={1}
                max={60}
                value={chatDuration}
                onChange={(event) => onChatDurationChange(Number(event.target.value) || 1)}
                className="mt-2 w-full accent-[var(--teal)]"
                aria-label="VLM time window duration"
              />
            </div>

            {frames.length > 0 ? (
              <>
                <div className="mb-2 flex items-center gap-2 text-xs text-[var(--ink-soft)]">
                  <span className="inline-flex h-2.5 w-2.5 rounded-full bg-[var(--teal)]" />
                  <span>Selected center frame</span>
                  <span className="inline-flex h-2.5 w-2.5 rounded-full bg-[#f59e0b]" />
                  <span>Frames sent to VLM window</span>
                </div>

                <div
                  ref={timelineRef}
                  onScroll={() => {
                    void handleTimelineScroll();
                  }}
                  className="flex gap-3 overflow-x-auto pb-1"
                >
                  {frames.map((frame, index) => {
                    const isSelected = frame.timestamp_ns === selectedTimestampNs;
                    const isInWindow = isFrameInVlmWindow(frame.timestamp_ns);
                    const isWindowStart = firstWindowFrameTs === frame.timestamp_ns;
                    const isWindowEnd = lastWindowFrameTs === frame.timestamp_ns;
                    return (
                      <button
                        key={frame.timestamp_ns}
                        ref={(node) => {
                          frameRefs.current[frame.timestamp_ns] = node;
                        }}
                        type="button"
                        onClick={() => onSelectTimestamp(frame.timestamp_ns)}
                        className={`relative min-w-[124px] overflow-hidden rounded-xl border text-left transition sm:min-w-[152px] ${
                          isSelected
                            ? "border-[var(--teal)] ring-2 ring-[var(--teal)]/30"
                            : isInWindow
                              ? "border-[#f59e0b] bg-[#fff7e5]"
                              : "border-[var(--line)] hover:border-[var(--teal)]/60"
                        }`}
                        aria-label={`Frame ${index + 1} at ${formatTimestampNs(frame.timestamp_ns)}`}
                      >
                        {isWindowStart ? (
                          <span className="absolute left-2 top-2 z-10 rounded-md bg-[#f59e0b] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                            Start
                          </span>
                        ) : null}
                        {isWindowEnd ? (
                          <span className="absolute right-2 top-2 z-10 rounded-md bg-[#f59e0b] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                            End
                          </span>
                        ) : null}
                        <img
                          src={getImageUrl(frame.file_path)}
                          alt={`Frame at ${formatTimestampNs(frame.timestamp_ns)}`}
                          className="aspect-video w-full bg-[var(--bg-sand)] object-cover"
                        />
                        <div className="px-2 py-2 text-xs text-[var(--ink-soft)]">{formatTimestampNs(frame.timestamp_ns)}</div>
                      </button>
                    );
                  })}
                </div>

                <div className="mt-3 flex items-center justify-between gap-3">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      void onLoadMoreLeft();
                    }}
                    disabled={!canLoadMoreLeft || isExtendingLeft || isLoadingFrames}
                  >
                    {isExtendingLeft ? "Loading..." : "Load older"}
                  </Button>
                  <p className="text-xs text-[var(--ink-soft)]">
                    Frame {selectedFrameIndex >= 0 ? selectedFrameIndex + 1 : "-"} / {frames.length}
                  </p>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      void onLoadMoreRight();
                    }}
                    disabled={!canLoadMoreRight || isExtendingRight || isLoadingFrames}
                  >
                    {isExtendingRight ? "Loading..." : "Load newer"}
                  </Button>
                </div>
              </>
            ) : (
              <div className="rounded-xl border border-dashed border-[var(--line)] bg-[var(--bg-paper)] px-4 py-6 text-sm text-[var(--ink-soft)]">
                {isLoadingFrames ? "Loading nearby frames..." : "No extracted frames were found for this window yet."}
              </div>
            )}
          </div>

          <div className="min-h-[280px] flex-1">
            <Card className="h-full bg-white/85">
              <CardContent className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-4 sm:p-5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <MessageSquareText className="h-4 w-4 text-[var(--teal)]" />
                    <p className="text-sm font-semibold">Ask About This Sequence</p>
                  </div>
                  <p className="mt-2 rounded-lg border border-[#f5d9a8] bg-[#fff7e8] px-3 py-2 text-xs text-[#8f5a11]">
                    Sending VLM window from {vlmWindowStartNs !== null ? formatTimestampNs(vlmWindowStartNs) : "-"}
                    {" "}to {vlmWindowEndNs !== null ? formatTimestampNs(vlmWindowEndNs) : "-"}, centered on{" "}
                    {selectedTimestampNs !== null ? formatTimestampNs(selectedTimestampNs) : "-"}.
                  </p>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--ink-soft)]">
                    Question
                  </label>
                  <textarea
                    value={chatQuery}
                    onChange={(event) => onChatQueryChange(event.target.value)}
                    placeholder="Describe what is happening over the next few seconds..."
                    className="min-h-24 w-full rounded-xl border border-[var(--line)] bg-white px-3 py-3 text-sm text-[var(--ink)] shadow-sm outline-none transition focus:border-[var(--teal)] focus:ring-2 focus:ring-[var(--teal)] sm:min-h-32"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--ink-soft)]">
                    Duration (seconds)
                  </label>
                  <Input
                    type="number"
                    min={1}
                    max={60}
                    value={chatDuration}
                    onChange={(event) => onChatDurationChange(Number(event.target.value) || 1)}
                  />
                </div>

                <Button type="button" onClick={onChat} disabled={isChatting} className="w-full">
                  {isChatting ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : null}
                  {isChatting ? "Asking VLM" : "Ask VLM"}
                </Button>

                <div className="min-h-24 rounded-xl border border-[var(--line)] bg-[var(--bg-paper)] p-4 text-sm leading-6 text-[var(--ink-soft)]">
                  {chatResponse ?? "Pick a frame in the timeline, ask a question, and the VLM response will appear here."}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </Card>
    </div>
  );
}