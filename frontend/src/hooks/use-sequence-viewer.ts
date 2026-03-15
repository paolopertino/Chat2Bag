import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import { chatWithClip, getFrames } from "../api/client";
import type { FrameInfo, SearchResult } from "../api/types";

const DEFAULT_WINDOW_SECONDS = 10;
const HALF_WINDOW_NS = (DEFAULT_WINDOW_SECONDS / 2) * 1_000_000_000;
const PAGED_LOAD_SECONDS = 20;

function mergeFrames(existing: FrameInfo[], incoming: FrameInfo[]): FrameInfo[] {
  const byTimestamp = new Map<number, FrameInfo>();
  for (const frame of existing) {
    byTimestamp.set(frame.timestamp_ns, frame);
  }
  for (const frame of incoming) {
    byTimestamp.set(frame.timestamp_ns, frame);
  }
  return Array.from(byTimestamp.values()).sort((a, b) => a.timestamp_ns - b.timestamp_ns);
}

function computeClipWindow(
  centerNs: number,
  durationSec: number,
  minNs: number,
  maxNs: number,
): { startNs: number; endNs: number } {
  if (maxNs <= minNs) {
    return { startNs: minNs, endNs: maxNs };
  }

  const durationNs = Math.max(1, Math.floor(durationSec * 1_000_000_000));
  const halfDurationNs = Math.floor(durationNs / 2);

  let startNs = centerNs - halfDurationNs;
  let endNs = startNs + durationNs;

  if (startNs < minNs) {
    startNs = minNs;
    endNs = startNs + durationNs;
  }
  if (endNs > maxNs) {
    endNs = maxNs;
    startNs = Math.max(minNs, endNs - durationNs);
  }

  return {
    startNs: Math.max(minNs, startNs),
    endNs: Math.min(maxNs, endNs),
  };
}

export function useSequenceViewer() {
  const [selectedResult, setSelectedResult] = useState<SearchResult | null>(null);
  const [frames, setFrames] = useState<FrameInfo[]>([]);
  const [selectedTimestampNs, setSelectedTimestampNs] = useState<number | null>(null);
  const [isLoadingFrames, setIsLoadingFrames] = useState(false);
  const [isExtendingLeft, setIsExtendingLeft] = useState(false);
  const [isExtendingRight, setIsExtendingRight] = useState(false);
  const [canLoadMoreLeft, setCanLoadMoreLeft] = useState(true);
  const [canLoadMoreRight, setCanLoadMoreRight] = useState(true);
  const [loadedRangeStartNs, setLoadedRangeStartNs] = useState<number | null>(null);
  const [loadedRangeEndNs, setLoadedRangeEndNs] = useState<number | null>(null);
  const [chatQuery, setChatQuery] = useState("");
  const [chatDuration, setChatDuration] = useState(DEFAULT_WINDOW_SECONDS);
  const [chatResponse, setChatResponse] = useState<string | null>(null);
  const [isChatting, setIsChatting] = useState(false);

  const isOpen = selectedResult !== null;

  const frameRange = useMemo(() => {
    if (frames.length === 0) {
      const fallback = selectedTimestampNs ?? selectedResult?.timestamp_ns ?? null;
      if (fallback === null) {
        return null;
      }
      return { minNs: fallback, maxNs: fallback };
    }
    return {
      minNs: frames[0].timestamp_ns,
      maxNs: frames[frames.length - 1].timestamp_ns,
    };
  }, [frames, selectedResult?.timestamp_ns, selectedTimestampNs]);

  const vlmWindow = useMemo(() => {
    if (selectedTimestampNs === null || !frameRange) {
      return null;
    }
    return computeClipWindow(
      selectedTimestampNs,
      chatDuration,
      frameRange.minNs,
      frameRange.maxNs,
    );
  }, [chatDuration, frameRange, selectedTimestampNs]);

  const selectedFrameIndex = useMemo(() => {
    if (selectedTimestampNs === null || frames.length === 0) {
      return -1;
    }
    return frames.findIndex((frame) => frame.timestamp_ns === selectedTimestampNs);
  }, [frames, selectedTimestampNs]);

  const activeFrame = useMemo(() => {
    if (!selectedResult) {
      return null;
    }

    return (
      frames.find((frame) => frame.timestamp_ns === selectedTimestampNs) ?? {
        timestamp_ns: selectedTimestampNs ?? selectedResult.timestamp_ns,
        file_path: selectedResult.file_path,
      }
    );
  }, [frames, selectedResult, selectedTimestampNs]);

  const closeViewer = useCallback(() => {
    setSelectedResult(null);
    setFrames([]);
    setSelectedTimestampNs(null);
    setLoadedRangeStartNs(null);
    setLoadedRangeEndNs(null);
    setCanLoadMoreLeft(true);
    setCanLoadMoreRight(true);
    setChatQuery("");
    setChatResponse(null);
    setChatDuration(DEFAULT_WINDOW_SECONDS);
  }, []);

  const openViewer = useCallback(async (result: SearchResult) => {
    const windowStartNs = Math.max(0, Math.floor(result.timestamp_ns - HALF_WINDOW_NS));

    setSelectedResult(result);
    setSelectedTimestampNs(result.timestamp_ns);
    setFrames([]);
    setLoadedRangeStartNs(null);
    setLoadedRangeEndNs(null);
    setCanLoadMoreLeft(true);
    setCanLoadMoreRight(true);
    setChatQuery("");
    setChatResponse(null);
    setChatDuration(DEFAULT_WINDOW_SECONDS);
    setIsLoadingFrames(true);

    try {
      const response = await getFrames(result.bag_path, windowStartNs, DEFAULT_WINDOW_SECONDS);
      const sortedFrames = response.frames.sort((a, b) => a.timestamp_ns - b.timestamp_ns);
      setFrames(sortedFrames);
      const defaultEndNs = windowStartNs + DEFAULT_WINDOW_SECONDS * 1_000_000_000;
      if (sortedFrames.length > 0) {
        setLoadedRangeStartNs(sortedFrames[0].timestamp_ns);
        setLoadedRangeEndNs(sortedFrames[sortedFrames.length - 1].timestamp_ns);
      } else {
        setLoadedRangeStartNs(windowStartNs);
        setLoadedRangeEndNs(defaultEndNs);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load sequence frames.";
      toast.error(message);
    } finally {
      setIsLoadingFrames(false);
    }
  }, []);

  const loadMoreLeft = useCallback(async (): Promise<FrameInfo[] | null> => {
    if (!selectedResult || isLoadingFrames || isExtendingLeft || !canLoadMoreLeft) {
      return null;
    }

    const durationSec = PAGED_LOAD_SECONDS;
    const durationNs = durationSec * 1_000_000_000;
    const currentStartNs = loadedRangeStartNs ?? selectedTimestampNs ?? selectedResult.timestamp_ns;
    const requestStartNs = Math.max(0, currentStartNs - durationNs);

    setIsExtendingLeft(true);
    let mergedFrames: FrameInfo[] | null = null;
    try {
      const response = await getFrames(selectedResult.bag_path, requestStartNs, durationSec);
      setFrames((prev) => {
        const merged = mergeFrames(prev, response.frames);
        mergedFrames = merged;
        if (merged.length > 0) {
          setLoadedRangeStartNs(merged[0].timestamp_ns);
          setLoadedRangeEndNs(merged[merged.length - 1].timestamp_ns);
        }
        const gainedEarlierFrame = merged.length > 0 && merged[0].timestamp_ns < currentStartNs;
        if (!gainedEarlierFrame) {
          setCanLoadMoreLeft(false);
        }
        return merged;
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load older frames.";
      toast.error(message);
    } finally {
      setIsExtendingLeft(false);
    }
    return mergedFrames;
  }, [
    canLoadMoreLeft,
    isExtendingLeft,
    isLoadingFrames,
    loadedRangeStartNs,
    selectedResult,
    selectedTimestampNs,
  ]);

  const loadMoreRight = useCallback(async (): Promise<FrameInfo[] | null> => {
    if (!selectedResult || isLoadingFrames || isExtendingRight || !canLoadMoreRight) {
      return null;
    }

    const durationSec = PAGED_LOAD_SECONDS;
    const currentEndNs = loadedRangeEndNs ?? selectedTimestampNs ?? selectedResult.timestamp_ns;
    const requestStartNs = Math.max(0, currentEndNs + 1);

    setIsExtendingRight(true);
    let mergedFrames: FrameInfo[] | null = null;
    try {
      const response = await getFrames(selectedResult.bag_path, requestStartNs, durationSec);
      setFrames((prev) => {
        const merged = mergeFrames(prev, response.frames);
        mergedFrames = merged;
        if (merged.length > 0) {
          setLoadedRangeStartNs(merged[0].timestamp_ns);
          setLoadedRangeEndNs(merged[merged.length - 1].timestamp_ns);
        }
        const gainedLaterFrame = merged.length > 0 && merged[merged.length - 1].timestamp_ns > currentEndNs;
        if (!gainedLaterFrame) {
          setCanLoadMoreRight(false);
        }
        return merged;
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load newer frames.";
      toast.error(message);
    } finally {
      setIsExtendingRight(false);
    }
    return mergedFrames;
  }, [
    canLoadMoreRight,
    isExtendingRight,
    isLoadingFrames,
    loadedRangeEndNs,
    selectedResult,
    selectedTimestampNs,
  ]);

  const selectPreviousFrame = useCallback(async () => {
    if (frames.length === 0 || selectedTimestampNs === null) {
      return;
    }

    const currentIndex = frames.findIndex((frame) => frame.timestamp_ns === selectedTimestampNs);
    if (currentIndex > 0) {
      setSelectedTimestampNs(frames[currentIndex - 1].timestamp_ns);
      return;
    }

    if (!canLoadMoreLeft) {
      return;
    }

    const merged = await loadMoreLeft();
    if (!merged) {
      return;
    }
    const nextIndex = merged.findIndex((frame) => frame.timestamp_ns === selectedTimestampNs);
    if (nextIndex > 0) {
      setSelectedTimestampNs(merged[nextIndex - 1].timestamp_ns);
    }
  }, [canLoadMoreLeft, frames, loadMoreLeft, selectedTimestampNs]);

  const selectNextFrame = useCallback(async () => {
    if (frames.length === 0 || selectedTimestampNs === null) {
      return;
    }

    const currentIndex = frames.findIndex((frame) => frame.timestamp_ns === selectedTimestampNs);
    if (currentIndex >= 0 && currentIndex < frames.length - 1) {
      setSelectedTimestampNs(frames[currentIndex + 1].timestamp_ns);
      return;
    }

    if (!canLoadMoreRight) {
      return;
    }

    const merged = await loadMoreRight();
    if (!merged) {
      return;
    }
    const nextIndex = merged.findIndex((frame) => frame.timestamp_ns === selectedTimestampNs);
    if (nextIndex >= 0 && nextIndex < merged.length - 1) {
      setSelectedTimestampNs(merged[nextIndex + 1].timestamp_ns);
    }
  }, [canLoadMoreRight, frames, loadMoreRight, selectedTimestampNs]);

  const runChat = useCallback(async () => {
    if (!selectedResult || selectedTimestampNs === null) {
      return;
    }
    if (!chatQuery.trim()) {
      toast.error("Enter a question for the sequence.");
      return;
    }

    setIsChatting(true);
    setChatResponse(null);
    try {
      const windowStartNs = vlmWindow?.startNs ?? selectedTimestampNs;
      const response = await chatWithClip({
        bag_path: selectedResult.bag_path,
        start_ns: windowStartNs,
        duration: chatDuration,
        query: chatQuery.trim(),
      });
      setChatResponse(response.response);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Video chat failed.";
      toast.error(message);
    } finally {
      setIsChatting(false);
    }
  }, [chatDuration, chatQuery, selectedResult, selectedTimestampNs, vlmWindow?.startNs]);

  const isFrameInVlmWindow = useCallback(
    (timestampNs: number) => {
      if (!vlmWindow) {
        return false;
      }
      return timestampNs >= vlmWindow.startNs && timestampNs <= vlmWindow.endNs;
    },
    [vlmWindow],
  );

  return {
    activeFrame,
    canLoadMoreLeft,
    canLoadMoreRight,
    chatDuration,
    chatQuery,
    chatResponse,
    closeViewer,
    frames,
    isExtendingLeft,
    isExtendingRight,
    isChatting,
    isFrameInVlmWindow,
    isLoadingFrames,
    isOpen,
    loadMoreLeft,
    loadMoreRight,
    openViewer,
    runChat,
    selectNextFrame,
    selectPreviousFrame,
    selectedFrameIndex,
    selectedResult,
    selectedTimestampNs,
    setChatDuration,
    setChatQuery,
    setSelectedTimestampNs,
    vlmWindowEndNs: vlmWindow?.endNs ?? null,
    vlmWindowStartNs: vlmWindow?.startNs ?? null,
  };
}