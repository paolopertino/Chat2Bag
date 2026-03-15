import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import { chatWithClip, getFrames } from "../api/client";
import type { FrameInfo, SearchResult } from "../api/types";

const DEFAULT_WINDOW_SECONDS = 10;
const HALF_WINDOW_NS = (DEFAULT_WINDOW_SECONDS / 2) * 1_000_000_000;

export function useSequenceViewer() {
  const [selectedResult, setSelectedResult] = useState<SearchResult | null>(null);
  const [frames, setFrames] = useState<FrameInfo[]>([]);
  const [selectedTimestampNs, setSelectedTimestampNs] = useState<number | null>(null);
  const [isLoadingFrames, setIsLoadingFrames] = useState(false);
  const [chatQuery, setChatQuery] = useState("");
  const [chatDuration, setChatDuration] = useState(DEFAULT_WINDOW_SECONDS);
  const [chatResponse, setChatResponse] = useState<string | null>(null);
  const [isChatting, setIsChatting] = useState(false);

  const isOpen = selectedResult !== null;

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
    setChatQuery("");
    setChatResponse(null);
    setChatDuration(DEFAULT_WINDOW_SECONDS);
  }, []);

  const openViewer = useCallback(async (result: SearchResult) => {
    const windowStartNs = Math.max(0, Math.floor(result.timestamp_ns - HALF_WINDOW_NS));

    setSelectedResult(result);
    setSelectedTimestampNs(result.timestamp_ns);
    setFrames([]);
    setChatQuery("");
    setChatResponse(null);
    setChatDuration(DEFAULT_WINDOW_SECONDS);
    setIsLoadingFrames(true);

    try {
      const response = await getFrames(result.bag_path, windowStartNs, DEFAULT_WINDOW_SECONDS);
      setFrames(response.frames);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load sequence frames.";
      toast.error(message);
    } finally {
      setIsLoadingFrames(false);
    }
  }, []);

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
      const response = await chatWithClip({
        bag_path: selectedResult.bag_path,
        start_ns: selectedTimestampNs,
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
  }, [chatDuration, chatQuery, selectedResult, selectedTimestampNs]);

  return {
    activeFrame,
    chatDuration,
    chatQuery,
    chatResponse,
    closeViewer,
    frames,
    isChatting,
    isLoadingFrames,
    isOpen,
    openViewer,
    runChat,
    selectedResult,
    selectedTimestampNs,
    setChatDuration,
    setChatQuery,
    setSelectedTimestampNs,
  };
}