import { getImageUrl } from "../../api/client";
import type { SearchResult } from "../../api/types";
import { ImageCard } from "./image-card";
import { Skeleton } from "../ui/skeleton";

interface ResultsGridProps {
  results: SearchResult[];
  isSearching: boolean;
}

export function ResultsGrid({ results, isSearching }: ResultsGridProps) {
  if (isSearching) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton key={index} className="h-56" />
        ))}
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-[var(--line)] bg-white/70 p-8 text-center text-sm text-[var(--ink-soft)]">
        No search results yet. Select bags, run indexing if needed, then search with a natural-language query.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {results.map((result) => (
        <ImageCard key={`${result.file_path}:${result.timestamp_ns}`} result={result} imageUrl={getImageUrl(result.file_path)} />
      ))}
    </div>
  );
}
