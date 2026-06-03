import { useMemo } from "react";

import type { Pin } from "../../types/pin";

interface PinRailProps {
  pins: Pin[];
  /** Bag's full time range. Determines x-position mapping. */
  bagStartNs: number | null;
  bagEndNs: number | null;
  /** Slice of time currently visible in the thumbnail strip (orange band). */
  viewportStartNs?: number | null;
  viewportEndNs?: number | null;
  /** The currently-selected pin timestamp (for emphasis). */
  selectedTimestampNs: number | null;
  onPinClick: (timestampNs: number) => void;
}

function pctOf(ts: number, start: number, end: number): number {
  if (end <= start) return 0;
  return ((ts - start) / (end - start)) * 100;
}

function pinColor(pin: Pin): string {
  if (pin.color) return pin.color;
  if (pin.source === "search") {
    const score = pin.score ?? 0;
    // map 0..1 score to teal opacity 0.4..1.0
    const opacity = 0.4 + score * 0.6;
    return `rgba(22, 160, 133, ${opacity.toFixed(2)})`;
  }
  return "var(--ink-soft)";
}

export function PinRail({
  pins,
  bagStartNs,
  bagEndNs,
  viewportStartNs,
  viewportEndNs,
  selectedTimestampNs,
  onPinClick,
}: PinRailProps) {
  const ready = bagStartNs !== null && bagEndNs !== null && bagEndNs > bagStartNs;

  const positionedPins = useMemo(() => {
    if (!ready || bagStartNs === null || bagEndNs === null) return [];
    const start = bagStartNs;
    const end = bagEndNs;
    return pins.map((pin) => ({
      pin,
      leftPct: pctOf(pin.timestamp_ns, start, end),
    }));
  }, [pins, ready, bagStartNs, bagEndNs]);

  const viewportLeftPct =
    ready && bagStartNs !== null && bagEndNs !== null && viewportStartNs != null
      ? pctOf(Math.max(viewportStartNs, bagStartNs), bagStartNs, bagEndNs)
      : null;
  const viewportRightPct =
    ready && bagStartNs !== null && bagEndNs !== null && viewportEndNs != null
      ? pctOf(Math.min(viewportEndNs, bagEndNs), bagStartNs, bagEndNs)
      : null;

  if (!ready) {
    return (
      <div className="rounded-md border border-dashed border-[var(--line)] px-2 py-1.5 text-[11px] text-[var(--ink-soft)]">
        Loading bag time range…
      </div>
    );
  }

  return (
    <div
      className="relative rounded-md border border-[var(--line)] bg-[var(--bg-paper)] px-2 py-2"
      role="group"
      aria-label="Pin rail"
    >
      <div className="mb-1 flex items-center justify-between text-[11px] text-[var(--ink-soft)]">
        <span>
          {pins.length} pin{pins.length === 1 ? "" : "s"}
        </span>
        {pins.length > 0 ? <span>↑↓ jump · click to focus</span> : null}
      </div>
      <div className="relative h-3 rounded-full bg-[var(--bg-sand)]">
        {viewportLeftPct !== null && viewportRightPct !== null ? (
          <div
            className="absolute top-0 h-full rounded-full bg-[#f59e0b]/25 ring-1 ring-[#f59e0b]/60"
            style={{
              left: `${viewportLeftPct}%`,
              width: `${Math.max(0.5, viewportRightPct - viewportLeftPct)}%`,
            }}
            aria-label="Visible thumbnail range"
          />
        ) : null}

        {positionedPins.map(({ pin, leftPct }, idx) => {
          const selected = selectedTimestampNs === pin.timestamp_ns;
          return (
            <button
              key={`${pin.source}-${pin.timestamp_ns}-${idx}`}
              type="button"
              onClick={() => onPinClick(pin.timestamp_ns)}
              className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-sm transition ${
                selected ? "z-10 ring-2 ring-white" : ""
              }`}
              style={{
                left: `${leftPct}%`,
                width: 4,
                height: selected ? 18 : 14,
                backgroundColor: pinColor(pin),
              }}
              aria-label={pin.label ?? `Pin at ${pin.timestamp_ns}`}
              title={pin.label ?? `${pin.source} @ ${pin.timestamp_ns}`}
            />
          );
        })}
      </div>
    </div>
  );
}
