import { useCallback, useState } from "react";
import { toast } from "sonner";

import { search, searchByImage, searchSimilar } from "../api/client";
import type { SearchResult } from "../api/types";

export function useSearch() {
  const [query, setQuery] = useState("");
  const [topK, setTopK] = useState(12);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const runSearch = useCallback(async (bagPaths: string[]) => {
    if (!query.trim()) {
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
        query: query.trim(),
        bag_paths: bagPaths,
        top_k: topK,
      });
      setResults(response.results);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Search failed.";
      toast.error(message);
    } finally {
      setIsSearching(false);
    }
  }, [query, topK]);

  const runImageSearch = useCallback(async (file: File, bagPaths: string[]) => {
    if (bagPaths.length === 0) {
      toast.error("Select at least one bag.");
      return;
    }

    setIsSearching(true);
    try {
      const response = await searchByImage(file, bagPaths, topK);
      setResults(response.results);
      toast.success(`Image search complete (${response.results.length} results).`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Image search failed.";
      toast.error(message);
    } finally {
      setIsSearching(false);
    }
  }, [topK]);

  const runSimilarSearch = useCallback(async (result: SearchResult, bagPaths: string[]) => {
    if (bagPaths.length === 0) {
      toast.error("Select at least one bag.");
      return;
    }

    setIsSearching(true);
    try {
      const response = await searchSimilar({
        file_path: result.file_path,
        bag_paths: bagPaths,
        top_k: topK,
      });
      setResults(response.results);
      toast.success(`Found ${response.results.length} similar result(s).`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Similar image search failed.";
      toast.error(message);
    } finally {
      setIsSearching(false);
    }
  }, [topK]);

  return {
    query,
    setQuery,
    topK,
    setTopK,
    results,
    isSearching,
    runSearch,
    runImageSearch,
    runSimilarSearch,
  };
}
