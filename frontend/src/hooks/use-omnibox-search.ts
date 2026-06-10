import { useEffect, useState } from "react";

import type { Area, Point, SearchResult } from "../api/types";
import { useMapArea } from "./use-map-area";
import { useRegionSearch } from "./use-region-search";
import { useUrlSearch } from "./use-url-search";

export type SupportSource =
  | { kind: "upload"; file: File; objectUrl: string }
  | { kind: "frame"; filePath: string };

export interface OmniboxSearch {
  text: string;
  setText: (t: string) => void;
  regionMode: boolean;
  setRegionMode: (on: boolean) => void;
  support: SupportSource | null;
  points: Point[];
  setSupport: (s: SupportSource | null, points?: Point[]) => void;
  setPoints: (p: Point[]) => void;
  area: Area | null;
  setArea: (a: Area | null) => void;
  bagPaths: string[];
  setBags: (ids: string[]) => void;
  topK: number;
  setTopK: (k: number) => void;
  minScore: number;
  setMinScore: (s: number) => void;
  results: SearchResult[];
  isSearching: boolean;
  activeKind: "none" | "global" | "region" | "browse";
  submit: () => void;
  loadMore: () => void;
  clear: () => void;
  fetchHeatmap: ReturnType<typeof useRegionSearch>["fetchHeatmap"];
}

export function useOmniboxSearch(options?: { scope?: { bagPaths: string[] } }): OmniboxSearch {
  const url = useUrlSearch({ scope: options?.scope, topKDefault: 100 });
  const region = useRegionSearch();
  const { area, setArea } = useMapArea();
  const [text, setText] = useState(url.q);
  const [regionMode, setRegionMode] = useState(false);

  // Sync text when the URL `q` param changes externally (back/forward navigation).
  useEffect(() => {
    setText(url.q);
  }, [url.q]);
  const [support, setSupportState] = useState<SupportSource | null>(null);
  const [points, setPoints] = useState<Point[]>([]);

  const regionActive = region.query !== null;
  const results = regionActive ? region.results : url.results;
  const activeKind: OmniboxSearch["activeKind"] = regionActive
    ? "region"
    : url.results.length > 0 || url.isSearching
      ? url.q || url.similar
        ? "global"
        : area
          ? "browse"
          : "none"
      : "none";

  function runRegion(topK: number) {
    if (support?.kind === "upload" && points.length > 0) {
      region.runImage(support.file, support.objectUrl, points, url.bagPaths, topK, area ?? undefined);
    } else if (support?.kind === "frame" && points.length > 0) {
      region.runFrame(support.filePath, points, url.bagPaths, topK, area ?? undefined);
    } else if (regionMode && text.trim()) {
      region.runText(text.trim(), url.bagPaths, topK, area ?? undefined);
    }
  }

  function submit() {
    if (support && points.length > 0) {
      url.clear();
      runRegion(url.topK);
      return;
    }
    if (support?.kind === "upload") {
      region.clear();
      void url.submitImage(support.file); // Global image search
      return;
    }
    if (text.trim()) {
      if (regionMode) {
        url.clear();
        region.runText(text.trim(), url.bagPaths, url.topK, area ?? undefined);
      } else {
        region.clear();
        url.submitText(text.trim()); // also covers Map browse composition via URL area
      }
      return;
    }
    // Empty query: Area alone = Map browse; useUrlSearch picks it up from the URL area param.
    region.clear();
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
    setSupportState(null);
    setPoints([]);
    setRegionMode(false);
    region.clear();
    url.clear();
  }

  return {
    text,
    setText,
    regionMode,
    setRegionMode,
    support,
    points,
    setSupport: (s, p) => {
      setSupportState(s);
      setPoints(p ?? []);
    },
    setPoints,
    area,
    setArea,
    bagPaths: url.bagPaths,
    setBags: url.setBags,
    topK: url.topK,
    setTopK: url.setTopK,
    minScore: url.minScore,
    setMinScore: url.setMinScore,
    results,
    isSearching: url.isSearching || region.isSearching,
    activeKind,
    submit,
    loadMore,
    clear,
    fetchHeatmap: region.fetchHeatmap,
  };
}
