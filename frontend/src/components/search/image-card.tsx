import type { SearchResult } from "../../api/types";
import { Card, CardContent } from "../ui/card";

function formatTimestampNs(ns: number): string {
  const ms = Math.floor(ns / 1_000_000);
  return `${ms.toLocaleString()} ms`;
}

interface ImageCardProps {
  result: SearchResult;
  imageUrl: string;
}

export function ImageCard({ result, imageUrl }: ImageCardProps) {
  return (
    <Card className="overflow-hidden transition hover:-translate-y-0.5">
      <img
        src={imageUrl}
        alt={`Search result from ${result.source_bag}`}
        loading="lazy"
        className="aspect-video w-full bg-[var(--bg-sand)] object-cover"
      />
      <CardContent className="space-y-1 p-3">
        <p className="truncate text-sm font-semibold">{result.source_bag}</p>
        <p className="font-mono text-xs text-[var(--ink-soft)]">score {(result.similarity_score * 100).toFixed(2)}%</p>
        <p className="font-mono text-xs text-[var(--ink-soft)]">t = {formatTimestampNs(result.timestamp_ns)}</p>
      </CardContent>
    </Card>
  );
}
