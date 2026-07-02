import { ChevronLeft, ChevronRight } from "lucide-react";
import { useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

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
  selectMode?: boolean;
  selectedWindow?: { startNs: number; endNs: number } | null;
  onWindowChange?: (startNs: number, endNs: number) => void;
}

function frac(ns: number, first: number, last: number): number {
  if (last <= first) return 0;
  return Math.min(1, Math.max(0, (ns - first) / (last - first)));
}

export function TimelineBar(props: TimelineBarProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<"start" | "end" | "paint" | null>(null);
  const paintAnchorNs = useRef<number>(0);

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

  const nsFromClientX = (clientX: number): number => {
    const el = trackRef.current;
    if (!el) return props.firstNs;
    const rect = el.getBoundingClientRect();
    const f = rect.width <= 0 ? 0 : Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return Math.round(props.firstNs + f * (props.lastNs - props.firstNs));
  };

  const emit = (a: number, b: number) => props.onWindowChange?.(Math.min(a, b), Math.max(a, b));

  const onPointerMove = (e: PointerEvent) => {
    const kind = dragRef.current;
    if (!kind) return;
    const ns = nsFromClientX(e.clientX);
    const w = props.selectedWindow ?? { startNs: ns, endNs: ns };
    if (kind === "paint") emit(paintAnchorNs.current, ns);
    else if (kind === "start") emit(ns, w.endNs);
    else emit(w.startNs, ns);
  };

  const onPointerUp = () => {
    dragRef.current = null;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
  };

  const beginDrag = (kind: "start" | "end" | "paint", e: ReactPointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = kind;
    if (kind === "paint") {
      const ns = nsFromClientX(e.clientX);
      paintAnchorNs.current = ns;
      emit(ns, ns);
    }
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  };

  const sel = props.selectMode ? props.selectedWindow ?? null : null;
  const selStart = sel ? frac(sel.startNs, props.firstNs, props.lastNs) : 0;
  const selEnd = sel ? frac(sel.endNs, props.firstNs, props.lastNs) : 0;

  return (
    <div className="flex items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2 py-1.5 backdrop-blur">
      <button onClick={props.onLoadLeft} disabled={!props.canLoadLeft} aria-label="Load earlier">
        <ChevronLeft className="h-4 w-4" />
      </button>
      <div
        ref={trackRef}
        className={"relative h-6 min-w-0 flex-1" + (props.selectMode ? " cursor-crosshair" : "")}
        onPointerDown={props.selectMode ? (e) => beginDrag("paint", e) : undefined}
      >
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
            onClick={() => {
              if (!props.selectMode) props.onPinClick(pin);
            }}
          />
        ))}
        {sel ? (
          <>
            <div
              className="absolute top-0 h-full border-x-2 border-orange-400 bg-orange-400/25"
              style={{
                left: `${selStart * 100}%`,
                width: `${Math.max(0.5, (selEnd - selStart) * 100)}%`,
              }}
            />
            <div
              className="absolute top-1/2 h-4 w-2 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize rounded bg-orange-400"
              style={{ left: `${selStart * 100}%` }}
              onPointerDown={(e) => beginDrag("start", e)}
            />
            <div
              className="absolute top-1/2 h-4 w-2 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize rounded bg-orange-400"
              style={{ left: `${selEnd * 100}%` }}
              onPointerDown={(e) => beginDrag("end", e)}
            />
          </>
        ) : null}
      </div>
      <button onClick={props.onLoadRight} disabled={!props.canLoadRight} aria-label="Load later">
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}
