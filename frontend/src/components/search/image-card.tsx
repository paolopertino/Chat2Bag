import { useCallback, useState } from "react";
import { Crosshair, ExternalLink, Search } from "lucide-react";
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
  explorerHref?: string;
  onClick?: () => void;
  onSimilarSearch?: (result: SearchResult) => void;
  /** Region mode: promote this frame to a region support image. */
  onUseAsRegionSupport?: (result: SearchResult) => void;
}

export function ImageCard({
  result,
  href,
  explorerHref,
  onClick,
  onSimilarSearch,
  onUseAsRegionSupport,
}: ImageCardProps) {
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
        <button type="button" onClick={onClick} className="block w-full cursor-pointer text-left">
          {imageArea}
        </button>
      )}
      <CardContent className="p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <p className="truncate text-sm font-semibold">{result.source_bag}</p>
            {result.similarity_score != null && (
              <p className="font-mono text-xs text-[var(--ink-soft)]">score {(result.similarity_score * 100).toFixed(2)}%</p>
            )}
            <p className="font-mono text-xs text-[var(--ink-soft)]">t = {formatTimestampNs(result.timestamp_ns)}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {explorerHref ? (
              <Button asChild variant="ghost" size="icon" className="h-8 w-8">
                <Link
                  to={explorerHref}
                  title="Open in Explorer"
                  aria-label="Open in Explorer"
                  onClick={(event) => {
                    event.stopPropagation();
                  }}
                >
                  <ExternalLink className="h-4 w-4" />
                </Link>
              </Button>
            ) : null}
            {onUseAsRegionSupport ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                title="Use as region support"
                aria-label="Use as region support"
                onClick={(event) => {
                  event.stopPropagation();
                  onUseAsRegionSupport(result);
                }}
              >
                <Crosshair className="h-4 w-4" />
              </Button>
            ) : null}
            {onSimilarSearch ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                title="Find similar images"
                aria-label="Find similar images"
                onClick={(event) => {
                  event.stopPropagation();
                  onSimilarSearch(result);
                }}
              >
                <Search className="h-4 w-4" />
              </Button>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
