import { useCallback, useState } from "react";
import { toast } from "sonner";

import {
  regionHeatmapByFrame,
  regionHeatmapByImage,
  regionSearchByFrame,
  regionSearchByImage,
} from "../api/client";
import type { Area, HeatmapResponse, Point, SearchResult } from "../api/types";

export type RegionQuery =
  | { kind: "image"; file: File; objectUrl: string; points: Point[] }
  | { kind: "frame"; filePath: string; points: Point[] };

function isUnavailable(error: unknown): boolean {
  return error instanceof Error && error.message.toLowerCase().includes("not available");
}

export function useRegionSearch() {
  const [query, setQuery] = useState<RegionQuery | null>(null);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  const clear = useCallback(() => {
    setQuery(null);
    setResults([]);
  }, []);

  const run = useCallback(
    async (next: RegionQuery, fetcher: () => Promise<SearchResult[]>) => {
      setIsSearching(true);
      setQuery(next);
      try {
        const rows = await fetcher();
        setResults(rows);
      } catch (error) {
        if (isUnavailable(error)) setUnavailable(true);
        setResults([]);
        toast.error(error instanceof Error ? error.message : "Region search failed.");
      } finally {
        setIsSearching(false);
      }
    },
    [],
  );

  const runImage = useCallback(
    (file: File, objectUrl: string, points: Point[], bagPaths: string[], topK: number, area?: Area) => {
      if (points.length === 0) {
        toast.error("Place at least one point on the support image.");
        return;
      }
      if (bagPaths.length === 0) {
        toast.error("Select at least one bag.");
        return;
      }
      void run({ kind: "image", file, objectUrl, points }, async () =>
        (await regionSearchByImage(file, points, bagPaths, topK, area)).results,
      );
    },
    [run],
  );

  const runFrame = useCallback(
    (filePath: string, points: Point[], bagPaths: string[], topK: number, area?: Area) => {
      if (points.length === 0) {
        toast.error("Place at least one point on the support frame.");
        return;
      }
      if (bagPaths.length === 0) {
        toast.error("Select at least one bag.");
        return;
      }
      void run({ kind: "frame", filePath, points }, async () =>
        (await regionSearchByFrame(filePath, points, bagPaths, topK, area)).results,
      );
    },
    [run],
  );

  // Re-issue the active region query with a (possibly changed) Area. Mirrors the
  // global path, whose URL effect re-runs the search when the Area changes.
  const rerunWithArea = useCallback(
    (bagPaths: string[], topK: number, area?: Area) => {
      if (!query) return;
      if (query.kind === "frame") runFrame(query.filePath, query.points, bagPaths, topK, area);
      else runImage(query.file, query.objectUrl, query.points, bagPaths, topK, area);
    },
    [query, runFrame, runImage],
  );

  const fetchHeatmap = useCallback(
    async (targetFilePath: string): Promise<HeatmapResponse | null> => {
      if (!query) return null;
      try {
        if (query.kind === "frame")
          return await regionHeatmapByFrame(query.filePath, query.points, targetFilePath);
        return await regionHeatmapByImage(query.file, query.points, targetFilePath);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Heatmap unavailable.");
        return null;
      }
    },
    [query],
  );

  return {
    query,
    results,
    isSearching,
    unavailable,
    runImage,
    runFrame,
    rerunWithArea,
    clear,
    fetchHeatmap,
  };
}
