import { useCallback, useState } from "react";
import { toast } from "sonner";

import { search } from "../api/client";
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

  return {
    query,
    setQuery,
    topK,
    setTopK,
    results,
    isSearching,
    runSearch,
  };
}
