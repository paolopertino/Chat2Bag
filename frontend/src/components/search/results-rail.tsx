import { useEffect, useRef, useState } from "react";

import type { SearchResult } from "../../api/types";
import { AuthImage } from "../ui/auth-image";

const PAGE = 20;

interface ResultsRailProps {
  results: SearchResult[];
  selectedIndex: number | null;
  onSelect: (index: number) => void;
  onLoadMore?: () => void;
  isSearching: boolean;
  className?: string;
}

export function ResultsRail({
  results,
  selectedIndex,
  onSelect,
  onLoadMore,
  isSearching,
  className,
}: ResultsRailProps) {
  // pageState tracks { results, visible } together so that a new results array
  // automatically resets visible to PAGE without needing an effect or ref read.
  const [pageState, setPageState] = useState<{ results: SearchResult[]; visible: number }>({
    results,
    visible: PAGE,
  });
  const visible = pageState.results === results ? pageState.visible : PAGE;
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting)
        setPageState((s) =>
          s.results === results
            ? { results, visible: Math.min(s.visible + PAGE, results.length) }
            : { results, visible: PAGE },
        );
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [results]);

  if (results.length === 0) return null;

  return (
    <div
      className={
        "flex items-stretch gap-2 overflow-x-auto rounded-lg border border-[var(--line)] bg-[var(--glass)] p-2 shadow-lg backdrop-blur " +
        (className ?? "")
      }
    >
      {results.slice(0, visible).map((result, i) => (
        <button
          key={`${result.file_path}-${i}`}
          className={
            "relative h-20 w-28 flex-none overflow-hidden rounded " +
            (i === selectedIndex ? "ring-2 ring-amber-400" : "ring-1 ring-white/10")
          }
          onClick={() => onSelect(i)}
          title={`${result.source_bag ?? result.bag_path} · ${result.timestamp_ns}`}
        >
          <AuthImage
            filePath={result.file_path}
            alt={String(result.source_bag ?? "")}
            className="h-full w-full object-cover"
          />
          {result.similarity_score !== undefined ? (
            <span className="absolute bottom-0 right-0 rounded-tl bg-black/70 px-1 text-[10px]">
              {result.similarity_score.toFixed(2)}
            </span>
          ) : null}
          {result.lat === undefined ? (
            <span
              className="absolute left-0 top-0 rounded-br bg-black/70 px-1 text-[10px]"
              title="No Frame location"
            >
              ⚠
            </span>
          ) : null}
        </button>
      ))}
      <div ref={sentinelRef} className="w-1 flex-none" />
      {visible >= results.length && onLoadMore ? (
        <button
          className="flex-none self-center rounded border border-[var(--line)] px-3 py-2 text-xs"
          onClick={onLoadMore}
          disabled={isSearching}
        >
          {isSearching ? "loading…" : "more"}
        </button>
      ) : null}
    </div>
  );
}
