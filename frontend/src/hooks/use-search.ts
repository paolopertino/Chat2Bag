import { useCallback, useState } from "react";
import { toast } from "sonner";

import { search, searchByImage, searchMap, searchSimilar } from "../api/client";
import type { Area, SearchResult } from "../api/types";

export function useSearch() {
  const [query, setQuery] = useState("");
  const [topK, setTopK] = useState(12);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const clearResults = useCallback(() => setResults([]), []);

  const runSearch = useCallback(
    async (bagPaths: string[], queryOverride?: string, topKOverride?: number, area?: Area) => {
      const q = queryOverride !== undefined ? queryOverride : query;
      const k = topKOverride !== undefined ? topKOverride : topK;
      if (!q.trim()) {
        toast.error("Please enter a search query.");
        return;
      }
      if (bagPaths.length === 0) {
        toast.error("Select at least one bag.");
        return;
      }

      setIsSearching(true);
      try {
        const response = await search({
          query: q.trim(),
          bag_paths: bagPaths,
          top_k: k,
          area,
        });
        setResults(response.results);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Search failed.";
        toast.error(message);
      } finally {
        setIsSearching(false);
      }
    },
    [query, topK],
  );

  const runMapBrowse = useCallback(
    async (area: Area, bagPaths: string[], topKOverride?: number) => {
      const k = topKOverride !== undefined ? topKOverride : topK;
      if (bagPaths.length === 0) {
        toast.error("Select at least one bag.");
        return;
      }
      setIsSearching(true);
      try {
        const response = await searchMap(area, bagPaths, k);
        setResults(response.results);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Map browse failed.";
        toast.error(message);
      } finally {
        setIsSearching(false);
      }
    },
    [topK],
  );

  const runImageSearch = useCallback(
    async (file: File, bagPaths: string[], topKOverride?: number) => {
      const k = topKOverride !== undefined ? topKOverride : topK;
      if (bagPaths.length === 0) {
        toast.error("Select at least one bag.");
        return;
      }

      setIsSearching(true);
      try {
        const response = await searchByImage(file, bagPaths, k);
        setResults(response.results);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Image search failed.";
        toast.error(message);
      } finally {
        setIsSearching(false);
      }
    },
    [topK],
  );

  const runSimilarSearch = useCallback(
    async (
      result: SearchResult | { file_path: string },
      bagPaths: string[],
      topKOverride?: number,
    ) => {
      const k = topKOverride !== undefined ? topKOverride : topK;
      if (bagPaths.length === 0) {
        toast.error("Select at least one bag.");
        return;
      }

      setIsSearching(true);
      try {
        const response = await searchSimilar({
          file_path: result.file_path,
          bag_paths: bagPaths,
          top_k: k,
        });
        setResults(response.results);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Similar image search failed.";
        toast.error(message);
      } finally {
        setIsSearching(false);
      }
    },
    [topK],
  );

  return {
    query,
    setQuery,
    topK,
    setTopK,
    results,
    isSearching,
    clearResults,
    runSearch,
    runImageSearch,
    runSimilarSearch,
    runMapBrowse,
  };
}
