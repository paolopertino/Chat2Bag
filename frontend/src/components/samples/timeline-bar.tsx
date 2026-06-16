import { ChevronLeft, ChevronRight } from "lucide-react";

import type { SampleInfo, SearchResult } from "../../api/types";

interface TimelineBarProps {
  samples: SampleInfo[];
  selectedIndex: number;
  firstNs: number;
  lastNs: number;
  pins: SearchResult[];
  onSelectSample: (index: number) => void;
  onPinClick: (pin: SearchResult) => void;
  onLoadLeft: () => void;
  onLoadRight: () => void;
  canLoadLeft: boolean;
  canLoadRight: boolean;
}

function frac(ns: number, first: number, last: number): number {
  if (last <= first) return 0;
  return Math.min(1, Math.max(0, (ns - first) / (last - first)));
}

export function TimelineBar(props: TimelineBarProps) {
  const windowStart = props.samples.length
    ? frac(props.samples[0].timestamp_ns, props.firstNs, props.lastNs)
    : 0;
  const windowEnd = props.samples.length
    ? frac(props.samples[props.samples.length - 1].timestamp_ns, props.firstNs, props.lastNs)
    : 0;
  const cursor =
    props.samples[props.selectedIndex] !== undefined
      ? frac(props.samples[props.selectedIndex].timestamp_ns, props.firstNs, props.lastNs)
      : 0;

  return (
    <div className="flex items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--glass)] px-2 py-1.5 backdrop-blur">
      <button onClick={props.onLoadLeft} disabled={!props.canLoadLeft} aria-label="Load earlier">
        <ChevronLeft className="h-4 w-4" />
      </button>
      <div className="relative h-6 min-w-0 flex-1">
        <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded bg-white/15" />
        <div
          className="absolute top-1/2 h-1 -translate-y-1/2 rounded bg-white/40"
          style={{
            left: `${windowStart * 100}%`,
            width: `${Math.max(0.5, (windowEnd - windowStart) * 100)}%`,
          }}
        />
        <div className="absolute top-0 h-full w-0.5 bg-sky-400" style={{ left: `${cursor * 100}%` }} />
        {props.pins.map((pin, i) => (
          <button
            key={`${pin.file_path}-${i}`}
            className="absolute top-0 h-2.5 w-2.5 -translate-x-1/2 rounded-full border border-white/50 bg-amber-400"
            style={{ left: `${frac(pin.timestamp_ns, props.firstNs, props.lastNs) * 100}%` }}
            title={pin.similarity_score?.toFixed(2)}
            onClick={() => props.onPinClick(pin)}
          />
        ))}
      </div>
      <button onClick={props.onLoadRight} disabled={!props.canLoadRight} aria-label="Load later">
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}
