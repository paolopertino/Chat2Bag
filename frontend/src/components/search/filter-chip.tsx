import { Settings2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface FilterChipProps {
  topK: number;
  minScore: number;
  /** Total raw hits returned from backend (before client-side filter). */
  rawResultCount: number;
  /** How many bags were searched (display only). */
  bagCount: number;
  /** Whether to show the topK slider (false on per-bag search). */
  showTopK?: boolean;
  onTopKChange: (k: number) => void;
  onMinScoreChange: (s: number) => void;
}

export function FilterChip({
  topK,
  minScore,
  rawResultCount,
  bagCount,
  showTopK = true,
  onTopKChange,
  onMinScoreChange,
}: FilterChipProps) {
  const [expanded, setExpanded] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!expanded) return;
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setExpanded(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [expanded]);

  return (
    <div
      ref={wrapRef}
      className="rounded-md border border-[var(--line)] bg-[var(--bg-paper)] px-3 py-2 text-xs"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {showTopK ? (
            <span>
              K=<strong>{topK}</strong>
            </span>
          ) : null}
          <span>
            ≥<strong>{minScore.toFixed(2)}</strong>
          </span>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="inline-flex items-center gap-1 text-[var(--teal)] hover:underline"
          >
            <Settings2 className="h-3 w-3" />
            {expanded ? "Hide" : "Adjust"}
          </button>
        </div>
        <div className="text-[var(--ink-soft)]">
          {rawResultCount} hit{rawResultCount === 1 ? "" : "s"} · {bagCount} bag
          {bagCount === 1 ? "" : "s"}
        </div>
      </div>

      {expanded ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {showTopK ? (
            <label className="block">
              <span className="mb-1 block text-[var(--ink-soft)]">Top K: {topK}</span>
              <input
                type="range"
                min={1}
                max={100}
                value={topK}
                onChange={(e) => onTopKChange(Number(e.target.value))}
                className="w-full accent-[var(--teal)]"
              />
            </label>
          ) : null}
          <label className="block">
            <span className="mb-1 block text-[var(--ink-soft)]">
              Min similarity: {minScore.toFixed(2)}
            </span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={minScore}
              onChange={(e) => onMinScoreChange(Number(e.target.value))}
              className="w-full accent-[var(--teal)]"
            />
          </label>
        </div>
      ) : null}
    </div>
  );
}
