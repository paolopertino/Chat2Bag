import { useEffect } from "react";
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
  chatDuration: number;
  chatQuery: string;
  chatResponse: string | null;
  frames: FrameInfo[];
  isChatting: boolean;
  isLoadingFrames: boolean;
  isOpen: boolean;
  onChat: () => void;
  onChatDurationChange: (value: number) => void;
  onChatQueryChange: (value: string) => void;
  onClose: () => void;
  onSelectTimestamp: (timestampNs: number) => void;
  result: SearchResult | null;
  selectedTimestampNs: number | null;
}

export function SequenceViewer({
  activeFrame,
  chatDuration,
  chatQuery,
  chatResponse,
  frames,
  isChatting,
  isLoadingFrames,
  isOpen,
  onChat,
  onChatDurationChange,
  onChatQueryChange,
  onClose,
  onSelectTimestamp,
  result,
  selectedTimestampNs,
}: SequenceViewerProps) {
  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen, onClose]);

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

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto p-3 sm:gap-5 sm:p-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.9fr)] lg:overflow-hidden">
          <div className="min-h-0 min-w-0 space-y-4 lg:overflow-hidden">
            <div className="overflow-hidden rounded-2xl border border-[var(--line)] bg-white/80">
              {activeFrame ? (
                <img
                  src={getImageUrl(activeFrame.file_path)}
                  alt={`Sequence frame from ${result.source_bag}`}
                  className="h-[clamp(220px,42vh,430px)] w-full bg-[var(--bg-sand)] object-cover"
                />
              ) : (
                <div className="flex h-[clamp(220px,42vh,430px)] items-center justify-center text-sm text-[var(--ink-soft)]">
                  No frame selected.
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-[var(--line)] bg-white/80 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">Timeline</p>
                  <p className="text-xs text-[var(--ink-soft)]">Browse nearby extracted frames and jump through the sequence.</p>
                </div>
                {isLoadingFrames ? <LoaderCircle className="h-4 w-4 animate-spin text-[var(--teal)]" /> : null}
              </div>

              {frames.length > 0 ? (
                <div className="flex gap-3 overflow-x-auto pb-1">
                  {frames.map((frame) => {
                    const isSelected = frame.timestamp_ns === selectedTimestampNs;
                    return (
                      <button
                        key={frame.timestamp_ns}
                        type="button"
                        onClick={() => onSelectTimestamp(frame.timestamp_ns)}
                        className={`min-w-[124px] overflow-hidden rounded-xl border text-left transition sm:min-w-[152px] ${
                          isSelected
                            ? "border-[var(--teal)] shadow-soft"
                            : "border-[var(--line)] hover:border-[var(--teal)]/60"
                        }`}
                      >
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
              ) : (
                <div className="rounded-xl border border-dashed border-[var(--line)] bg-[var(--bg-paper)] px-4 py-6 text-sm text-[var(--ink-soft)]">
                  {isLoadingFrames ? "Loading nearby frames..." : "No extracted frames were found for this window yet."}
                </div>
              )}
            </div>
          </div>

          <div className="min-h-0 min-w-0 space-y-4 lg:overflow-y-auto">
            <Card className="bg-white/85">
              <CardContent className="space-y-4 p-5">
                <div className="flex items-center gap-2">
                  <MessageSquareText className="h-4 w-4 text-[var(--teal)]" />
                  <p className="text-sm font-semibold">Ask About This Sequence</p>
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

                <div className="max-h-44 overflow-y-auto rounded-xl border border-[var(--line)] bg-[var(--bg-paper)] p-4 text-sm leading-6 text-[var(--ink-soft)] sm:max-h-56">
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