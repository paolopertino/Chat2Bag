import { useCallback, useState } from "react";
import { Search } from "lucide-react";
import { Link } from "react-router-dom";

import type { SearchResult } from "../../api/types";
import { Button } from "../ui/button";
import { Card, CardContent } from "../ui/card";
import { AuthImage } from "../ui/auth-image";

function formatTimestampNs(ns: number): string {
  const ms = Math.floor(ns / 1_000_000);
  return `${ms.toLocaleString()} ms`;
}

interface ImageCardProps {
  result: SearchResult;
  /** When provided, renders the image area as a `<Link>` so Cmd/Ctrl-click opens a new tab. */
  href?: string;
  onClick?: () => void;
  onSimilarSearch?: (result: SearchResult) => void;
}

export function ImageCard({ result, href, onClick, onSimilarSearch }: ImageCardProps) {
  const filePath = result.file_path;
  const [hasImageError, setHasImageError] = useState(false);
  const handleImageError = useCallback(() => setHasImageError(true), []);

  const imageArea = hasImageError ? (
    <div className="flex aspect-video w-full items-center justify-center bg-[var(--bg-sand)] text-sm text-[var(--ink-soft)]">
      Preview unavailable
    </div>
  ) : (
    <AuthImage
      filePath={filePath}
      alt={`Search result from ${result.source_bag}`}
      onError={handleImageError}
      className="aspect-video w-full bg-[var(--bg-sand)] object-cover"
    />
  );

  return (
    <Card className="overflow-hidden transition hover:-translate-y-0.5">
      {href ? (
        <Link to={href} className="block w-full text-left">
          {imageArea}
        </Link>
      ) : (
        <button
          type="button"
          onClick={onClick}
          className="block w-full cursor-pointer text-left"
        >
          {imageArea}
        </button>
      )}
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
