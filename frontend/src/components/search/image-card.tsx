import { useState } from "react";
import { Search } from "lucide-react";

import type { SearchResult } from "../../api/types";
import { Button } from "../ui/button";
import { Card, CardContent } from "../ui/card";

function formatTimestampNs(ns: number): string {
  const ms = Math.floor(ns / 1_000_000);
  return `${ms.toLocaleString()} ms`;
}

interface ImageCardProps {
  result: SearchResult;
  imageUrl: string;
  onClick?: () => void;
  onSimilarSearch?: (result: SearchResult) => void;
}

export function ImageCard({ result, imageUrl, onClick, onSimilarSearch }: ImageCardProps) {
  const [hasImageError, setHasImageError] = useState(false);

  return (
    <Card className="overflow-hidden transition hover:-translate-y-0.5">
      <button
        type="button"
        onClick={onClick}
        className="block w-full cursor-pointer text-left"
      >
        {hasImageError ? (
          <div className="flex aspect-video w-full items-center justify-center bg-[var(--bg-sand)] text-sm text-[var(--ink-soft)]">
            Preview unavailable
          </div>
        ) : (
          <img
            src={imageUrl}
            alt={`Search result from ${result.source_bag}`}
            loading="lazy"
            onError={() => setHasImageError(true)}
            className="aspect-video w-full bg-[var(--bg-sand)] object-cover"
          />
        )}
      </button>
      <CardContent className="p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <p className="truncate text-sm font-semibold">{result.source_bag}</p>
            <p className="font-mono text-xs text-[var(--ink-soft)]">score {(result.similarity_score * 100).toFixed(2)}%</p>
            <p className="font-mono text-xs text-[var(--ink-soft)]">t = {formatTimestampNs(result.timestamp_ns)}</p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            title="Find similar images"
            aria-label="Find similar images"
            onClick={(event) => {
              event.stopPropagation();
              onSimilarSearch?.(result);
            }}
          >
            <Search className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
