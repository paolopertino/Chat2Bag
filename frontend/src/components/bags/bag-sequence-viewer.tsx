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
