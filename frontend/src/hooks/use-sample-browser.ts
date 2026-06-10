import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { chatWithClip, getSamples } from "../api/client";
import type { SampleInfo, SamplesResponse, SearchResult } from "../api/types";

const DEFAULT_WINDOW_SECONDS = 10;
const HALF_WINDOW_NS = (DEFAULT_WINDOW_SECONDS / 2) * 1_000_000_000;
const PAGED_LOAD_SECONDS = 20;

function mergeSamples(existing: SampleInfo[], incoming: SampleInfo[]): SampleInfo[] {
  const byTimestamp = new Map<number, SampleInfo>();
  for (const sample of existing) byTimestamp.set(sample.timestamp_ns, sample);
  for (const sample of incoming) byTimestamp.set(sample.timestamp_ns, sample);
  return Array.from(byTimestamp.values()).sort((a, b) => a.timestamp_ns - b.timestamp_ns);
}

function nearestSampleTimestamp(samples: SampleInfo[], targetNs: number): number | null {
  if (samples.length === 0) return null;
  let best = samples[0].timestamp_ns;
  let bestDiff = Math.abs(best - targetNs);
  for (const sample of samples) {
    const diff = Math.abs(sample.timestamp_ns - targetNs);
    if (diff < bestDiff) {
      best = sample.timestamp_ns;
      bestDiff = diff;
    }
  }
  return best;
}

function computeClipWindow(
  centerNs: number,
  durationSec: number,
  minNs: number,
  maxNs: number,
): { startNs: number; endNs: number } {
  if (maxNs <= minNs) return { startNs: minNs, endNs: maxNs };
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
  return { startNs: Math.max(minNs, startNs), endNs: Math.min(maxNs, endNs) };
}

export function useSampleBrowser() {
  const requestIdRef = useRef(0);
  const [selectedResult, setSelectedResult] = useState<SearchResult | null>(null);
  const [samples, setSamples] = useState<SampleInfo[]>([]);
  const [cameras, setCameras] = useState<string[]>([]);
  const [anchorCamera, setAnchorCamera] = useState<string | null>(null);
  const [sampleToleranceNs, setSampleToleranceNs] = useState<number | null>(null);
  const [selectedTimestampNs, setSelectedTimestampNs] = useState<number | null>(null);
  const [isLoadingSamples, setIsLoadingSamples] = useState(false);
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

  const selectedSampleIndex = useMemo(() => {
    if (selectedTimestampNs === null) return -1;
    return samples.findIndex((sample) => sample.timestamp_ns === selectedTimestampNs);
  }, [samples, selectedTimestampNs]);

  const activeSample = useMemo(() => {
    if (selectedTimestampNs === null) return null;
    return samples.find((sample) => sample.timestamp_ns === selectedTimestampNs) ?? null;
  }, [samples, selectedTimestampNs]);

  const frameRange = useMemo(() => {
    if (samples.length === 0) {
      const fallback = selectedTimestampNs ?? selectedResult?.timestamp_ns ?? null;
      return fallback === null ? null : { minNs: fallback, maxNs: fallback };
    }
    return { minNs: samples[0].timestamp_ns, maxNs: samples[samples.length - 1].timestamp_ns };
  }, [samples, selectedResult?.timestamp_ns, selectedTimestampNs]);

  const vlmWindow = useMemo(() => {
    if (selectedTimestampNs === null || !frameRange) return null;
    return computeClipWindow(selectedTimestampNs, chatDuration, frameRange.minNs, frameRange.maxNs);
  }, [chatDuration, frameRange, selectedTimestampNs]);

  const applyResponse = useCallback((
    response: SamplesResponse,
    requestStartNs: number,
    durationSec: number,
    reconcileSelection: boolean,
    preferredSelectedNs: number,
  ) => {
    const sorted = response.samples.sort((a, b) => a.timestamp_ns - b.timestamp_ns);
    setSamples(sorted);
    setCameras(response.cameras);
    setAnchorCamera(response.anchor_camera);
    setSampleToleranceNs(response.sample_tolerance_ns);
    const defaultEndNs = requestStartNs + durationSec * 1_000_000_000;
    if (sorted.length > 0) {
      setLoadedRangeStartNs(sorted[0].timestamp_ns);
      setLoadedRangeEndNs(sorted[sorted.length - 1].timestamp_ns);
      if (reconcileSelection) {
        setSelectedTimestampNs(nearestSampleTimestamp(sorted, preferredSelectedNs) ?? preferredSelectedNs);
      }
    } else {
      setLoadedRangeStartNs(requestStartNs);
      setLoadedRangeEndNs(defaultEndNs);
    }
  }, []);

  const loadSamples = useCallback(async ({
    bagPath,
    requestStartNs,
    durationSec,
    preferredSelectedNs,
    requestId,
    reconcileSelection,
  }: {
    bagPath: string;
    requestStartNs: number;
    durationSec: number;
    preferredSelectedNs: number;
    requestId: number;
    reconcileSelection: boolean;
  }) => {
    const isStale = () => requestIdRef.current !== requestId;
    try {
      const response = await getSamples(bagPath, requestStartNs, durationSec);
      if (isStale()) return;
      applyResponse(response, requestStartNs, durationSec, reconcileSelection, preferredSelectedNs);
    } catch (error) {
      if (!isStale()) toast.error(error instanceof Error ? error.message : "Failed to load Samples.");
    } finally {
      if (!isStale()) setIsLoadingSamples(false);
    }
  }, [applyResponse]);

  const resetForResult = useCallback((result: SearchResult, selectedNs: number) => {
    setSelectedResult(result);
    setSelectedTimestampNs(selectedNs);
    setSamples([]);
    setCameras([]);
    setAnchorCamera(null);
    setSampleToleranceNs(null);
    setLoadedRangeStartNs(null);
    setLoadedRangeEndNs(null);
    setCanLoadMoreLeft(true);
    setCanLoadMoreRight(true);
    setChatQuery("");
    setChatResponse(null);
    setChatDuration(DEFAULT_WINDOW_SECONDS);
    setIsLoadingSamples(true);
  }, []);

  const openForBag = useCallback(async ({
    bagPath,
    bagName,
    startNs,
    durationSec = DEFAULT_WINDOW_SECONDS,
  }: {
    bagPath: string;
    bagName: string;
    startNs: number;
    durationSec?: number;
  }) => {
    const synthetic: SearchResult = {
      bag_path: bagPath,
      timestamp_ns: startNs,
      file_path: "",
      topic: "",
      similarity_score: 0,
      source_bag: bagName,
    };
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const windowStartNs = Math.max(0, Math.floor(startNs - (durationSec * 1_000_000_000) / 2));
    resetForResult(synthetic, startNs);
    await loadSamples({
      bagPath,
      requestStartNs: windowStartNs,
      durationSec,
      preferredSelectedNs: startNs,
      requestId,
      reconcileSelection: true,
    });
  }, [loadSamples, resetForResult]);

  const loadMoreLeft = useCallback(async (): Promise<SampleInfo[] | null> => {
    if (!selectedResult || isLoadingSamples || isExtendingLeft || !canLoadMoreLeft) return null;
    const durationSec = PAGED_LOAD_SECONDS;
    const durationNs = durationSec * 1_000_000_000;
    const currentStartNs = loadedRangeStartNs ?? selectedTimestampNs ?? selectedResult.timestamp_ns;
    const requestStartNs = Math.max(0, currentStartNs - durationNs);
    setIsExtendingLeft(true);
    let mergedSamples: SampleInfo[] | null = null;
    try {
      const response = await getSamples(selectedResult.bag_path, requestStartNs, durationSec);
      setCameras(response.cameras);
      setAnchorCamera(response.anchor_camera);
      setSampleToleranceNs(response.sample_tolerance_ns);
      setSamples((prev) => {
        const merged = mergeSamples(prev, response.samples);
        mergedSamples = merged;
        if (merged.length > 0) {
          setLoadedRangeStartNs(merged[0].timestamp_ns);
          setLoadedRangeEndNs(merged[merged.length - 1].timestamp_ns);
        }
        if (merged.length === 0 || merged[0].timestamp_ns >= currentStartNs) setCanLoadMoreLeft(false);
        return merged;
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load older Samples.");
    } finally {
      setIsExtendingLeft(false);
    }
    return mergedSamples;
  }, [
    canLoadMoreLeft,
    isExtendingLeft,
    isLoadingSamples,
    loadedRangeStartNs,
    selectedResult,
    selectedTimestampNs,
  ]);

  const loadMoreRight = useCallback(async (): Promise<SampleInfo[] | null> => {
    if (!selectedResult || isLoadingSamples || isExtendingRight || !canLoadMoreRight) return null;
    const durationSec = PAGED_LOAD_SECONDS;
    const currentEndNs = loadedRangeEndNs ?? selectedTimestampNs ?? selectedResult.timestamp_ns;
    const requestStartNs = Math.max(0, currentEndNs + 1);
    setIsExtendingRight(true);
    let mergedSamples: SampleInfo[] | null = null;
    try {
      const response = await getSamples(selectedResult.bag_path, requestStartNs, durationSec);
      setCameras(response.cameras);
      setAnchorCamera(response.anchor_camera);
      setSampleToleranceNs(response.sample_tolerance_ns);
      setSamples((prev) => {
        const merged = mergeSamples(prev, response.samples);
        mergedSamples = merged;
        if (merged.length > 0) {
          setLoadedRangeStartNs(merged[0].timestamp_ns);
          setLoadedRangeEndNs(merged[merged.length - 1].timestamp_ns);
        }
        if (merged.length === 0 || merged[merged.length - 1].timestamp_ns <= currentEndNs) {
          setCanLoadMoreRight(false);
        }
        return merged;
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load newer Samples.");
    } finally {
      setIsExtendingRight(false);
    }
    return mergedSamples;
  }, [
    canLoadMoreRight,
    isExtendingRight,
    isLoadingSamples,
    loadedRangeEndNs,
    selectedResult,
    selectedTimestampNs,
  ]);

  const selectPreviousSample = useCallback(async () => {
    if (samples.length === 0 || selectedTimestampNs === null) return;
    const currentIndex = samples.findIndex((sample) => sample.timestamp_ns === selectedTimestampNs);
    if (currentIndex > 0) {
      setSelectedTimestampNs(samples[currentIndex - 1].timestamp_ns);
      return;
    }
    if (!canLoadMoreLeft) return;
    const merged = await loadMoreLeft();
    const nextIndex = merged?.findIndex((sample) => sample.timestamp_ns === selectedTimestampNs) ?? -1;
    if (merged && nextIndex > 0) setSelectedTimestampNs(merged[nextIndex - 1].timestamp_ns);
  }, [canLoadMoreLeft, loadMoreLeft, samples, selectedTimestampNs]);

  const selectNextSample = useCallback(async () => {
    if (samples.length === 0 || selectedTimestampNs === null) return;
    const currentIndex = samples.findIndex((sample) => sample.timestamp_ns === selectedTimestampNs);
    if (currentIndex >= 0 && currentIndex < samples.length - 1) {
      setSelectedTimestampNs(samples[currentIndex + 1].timestamp_ns);
      return;
    }
    if (!canLoadMoreRight) return;
    const merged = await loadMoreRight();
    const nextIndex = merged?.findIndex((sample) => sample.timestamp_ns === selectedTimestampNs) ?? -1;
    if (merged && nextIndex >= 0 && nextIndex < merged.length - 1) {
      setSelectedTimestampNs(merged[nextIndex + 1].timestamp_ns);
    }
  }, [canLoadMoreRight, loadMoreRight, samples, selectedTimestampNs]);

  const jumpToTimestamp = useCallback(async (ns: number) => {
    const withinLoaded =
      loadedRangeStartNs !== null &&
      loadedRangeEndNs !== null &&
      ns >= loadedRangeStartNs &&
      ns <= loadedRangeEndNs;
    if (withinLoaded) {
      setSelectedTimestampNs(nearestSampleTimestamp(samples, ns) ?? ns);
      return;
    }
    if (!selectedResult) return;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const windowStartNs = Math.max(0, Math.floor(ns - HALF_WINDOW_NS));
    setIsLoadingSamples(true);
    setSelectedTimestampNs(ns);
    setLoadedRangeStartNs(null);
    setLoadedRangeEndNs(null);
    setCanLoadMoreLeft(true);
    setCanLoadMoreRight(true);
    await loadSamples({
      bagPath: selectedResult.bag_path,
      requestStartNs: windowStartNs,
      durationSec: DEFAULT_WINDOW_SECONDS,
      preferredSelectedNs: ns,
      requestId,
      reconcileSelection: true,
    });
  }, [loadedRangeEndNs, loadedRangeStartNs, loadSamples, samples, selectedResult]);

  const runChat = useCallback(async () => {
    if (!selectedResult || selectedTimestampNs === null) return;
    if (!chatQuery.trim()) {
      toast.error("Enter a question for the Sample.");
      return;
    }
    setIsChatting(true);
    setChatResponse(null);
    try {
      const response = await chatWithClip({
        bag_path: selectedResult.bag_path,
        start_ns: vlmWindow?.startNs ?? selectedTimestampNs,
        duration: chatDuration,
        query: chatQuery.trim(),
      });
      setChatResponse(response.response);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Video chat failed.");
    } finally {
      setIsChatting(false);
    }
  }, [chatDuration, chatQuery, selectedResult, selectedTimestampNs, vlmWindow?.startNs]);

  const isSampleInVlmWindow = useCallback((timestampNs: number) => {
    if (!vlmWindow) return false;
    return timestampNs >= vlmWindow.startNs && timestampNs <= vlmWindow.endNs;
  }, [vlmWindow]);

  return {
    activeSample,
    anchorCamera,
    cameras,
    canLoadMoreLeft,
    canLoadMoreRight,
    chatDuration,
    chatQuery,
    chatResponse,
    isChatting,
    isExtendingLeft,
    isExtendingRight,
    isLoadingSamples,
    isSampleInVlmWindow,
    jumpToTimestamp,
    loadMoreLeft,
    loadMoreRight,
    openForBag,
    runChat,
    sampleToleranceNs,
    samples,
    selectNextSample,
    selectPreviousSample,
    selectedResult,
    selectedSampleIndex,
    selectedTimestampNs,
    setChatDuration,
    setChatQuery,
    setSelectedTimestampNs,
    vlmWindowEndNs: vlmWindow?.endNs ?? null,
    vlmWindowStartNs: vlmWindow?.startNs ?? null,
  };
}
