import { useCallback, useEffect, useRef, useState } from "react";

import type { Area, Point, SearchResult } from "../api/types";
import type { SupportFrame } from "../lib/region-support";
import { useMapArea } from "./use-map-area";
import { useRegionSearch } from "./use-region-search";
import { useSearchThresholds } from "./use-search-thresholds";
import { useSourceDraft } from "./use-source-draft";
import { useUrlSearch } from "./use-url-search";

export type SupportSource =
  | { kind: "upload"; file: File; objectUrl: string }
  // `filePath` is the currently-selected frame; `frames` are the per-camera
  // candidates the user can switch between in the region-support dialog.
  | { kind: "frame"; filePath: string; frames: SupportFrame[] };

export interface OmniboxSearch {
  text: string;
  setText: (t: string) => void;
  support: SupportSource | null;
  points: Point[];
  setSupport: (s: SupportSource | null, points?: Point[]) => void;
  setPoints: (p: Point[]) => void;
  area: Area | null;
  setArea: (a: Area | null) => void;
  bagPaths: string[];
  topK: number;
  setTopK: (k: number) => void;
  textThreshold: number;
  visualThreshold: number;
  setTextThreshold: (v: number) => void;
  setVisualThreshold: (v: number) => void;
  activeThreshold: number;
  modality: "text" | "visual" | null;
  results: SearchResult[];
  isSearching: boolean;
  rawResultCount: number;
  activeKind: "none" | "global" | "region" | "browse";
  submit: () => void;
  submitSupportRegion: (points: Point[], chosenFilePath?: string) => void;
  loadMore: () => void;
  clear: () => void;
  clearSupport: () => void;
  fetchHeatmap: ReturnType<typeof useRegionSearch>["fetchHeatmap"];
}

function revokeSupportObjectUrl(support: SupportSource | null): void {
  if (support?.kind === "upload") URL.revokeObjectURL(support.objectUrl);
}

export function useOmniboxSearch(options?: { scope?: { bagPaths: string[] } }): OmniboxSearch {
  const url = useUrlSearch({ scope: options?.scope, topKDefault: 100 });
  const region = useRegionSearch();
  const { area, setArea } = useMapArea();
  const [text, setText] = useSourceDraft(url.q);
  const [support, setSupportState] = useState<SupportSource | null>(null);
  const supportRef = useRef<SupportSource | null>(null);
  const [points, setPoints] = useState<Point[]>([]);

  const thresholds = useSearchThresholds();
  const [modality, setModality] = useState<"text" | "visual" | null>(null);
  const activeThreshold = modality === "visual" ? thresholds.visual : thresholds.text;

  const setSupport = useCallback((next: SupportSource | null, nextPoints: Point[] = []) => {
    const previous = supportRef.current;
    if (
      previous?.kind === "upload" &&
      (next?.kind !== "upload" || next.objectUrl !== previous.objectUrl)
    ) {
      URL.revokeObjectURL(previous.objectUrl);
    }
    supportRef.current = next;
    setSupportState(next);
    setPoints(nextPoints);
  }, []);

  useEffect(
    () => () => {
      revokeSupportObjectUrl(supportRef.current);
      supportRef.current = null;
    },
    [],
  );

  const regionActive = region.query !== null;
  const rawResults = regionActive ? region.results : url.results;
  const results = rawResults.filter((r) => (r.similarity_score ?? 1) >= activeThreshold);
  const rawResultCount = regionActive ? region.results.length : url.rawResultCount;
  const activeKind: OmniboxSearch["activeKind"] = regionActive
    ? "region"
    : url.results.length > 0 || url.isSearching
      ? url.q || url.similar
        ? "global"
        : area
          ? "browse"
          : "none"
      : "none";

  function runRegionWith(src: SupportSource | null, topK: number, regionPoints: Point[]) {
    if (src?.kind === "upload" && regionPoints.length > 0) {
      region.runImage(src.file, src.objectUrl, regionPoints, url.bagPaths, topK, area ?? undefined);
    } else if (src?.kind === "frame" && regionPoints.length > 0) {
      region.runFrame(src.filePath, regionPoints, url.bagPaths, topK, area ?? undefined);
    }
  }

  function runRegion(topK: number, regionPoints = points) {
    runRegionWith(support, topK, regionPoints);
  }

  function submitSupportRegion(nextPoints: Point[], chosenFilePath?: string) {
    // The camera may have been switched inside the dialog, so resolve the
    // effective support locally and run against it directly — relying on the
    // `support` state here would use the pre-switch frame (stale-state race).
    let effective = support;
    if (chosenFilePath && support?.kind === "frame" && chosenFilePath !== support.filePath) {
      effective = { ...support, filePath: chosenFilePath };
      setSupport(effective, nextPoints);
    } else {
      setPoints(nextPoints);
    }
    if (!effective) return;

    setModality("visual");
    if (nextPoints.length === 0) {
      // No region points placed → run a whole-frame (global) search.
      region.clear();
      if (effective.kind === "upload") void url.submitImage(effective.file);
      else url.submitSimilar(effective.filePath);
      return;
    }
    url.clear();
    runRegionWith(effective, url.topK, nextPoints);
  }

  function submit() {
    if (support && points.length > 0) {
      url.clear();
      setModality("visual");
      runRegion(url.topK);
      return;
    }
    if (support?.kind === "upload") {
      region.clear();
      setModality("visual");
      void url.submitImage(support.file); // Global image search
      return;
    }
    if (text.trim()) {
      region.clear();
      setModality("text");
      url.submitText(text.trim()); // also covers Map browse composition via URL area
      return;
    }
    // Empty query: Area alone = Map browse; useUrlSearch picks it up from the URL area param.
    region.clear();
    setModality(null);
    url.submitText("");
  }

  function loadMore() {
    const next = Math.min(url.topK * 2, 500);
    url.setTopK(next);
    if (regionActive) region.rerunWithArea(url.bagPaths, next, area ?? undefined);
    // Global/browse: useUrlSearch re-runs on topK change.
  }

  function clear() {
    setText("");
    setSupport(null);
    setModality(null);
    region.clear();
    url.clear();
  }

  // Removing the support chip cancels the search it powered (region, or a
  // whole-frame image/similar search), which the text-input clear can't reach
  // because those searches carry no text. The typed query is left intact.
  function clearSupport() {
    setSupport(null);
    setModality(null);
    region.clear();
    url.clear();
  }

  return {
    text,
    setText,
    support,
    points,
    setSupport,
    setPoints,
    area,
    setArea,
    bagPaths: url.bagPaths,
    topK: url.topK,
    setTopK: url.setTopK,
    textThreshold: thresholds.text,
    visualThreshold: thresholds.visual,
    setTextThreshold: thresholds.setText,
    setVisualThreshold: thresholds.setVisual,
    activeThreshold,
    modality,
    results,
    isSearching: url.isSearching || region.isSearching,
    rawResultCount,
    activeKind,
    submit,
    submitSupportRegion,
    loadMore,
    clear,
    clearSupport,
    fetchHeatmap: region.fetchHeatmap,
  };
}
