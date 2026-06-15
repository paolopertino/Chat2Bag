import { ChevronDown, Circle, MapPinned, Pentagon, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { Area } from "../../api/types";

interface AreaDrawChipProps {
  /** The currently committed Area filter, or null when none is set. */
  area: Area | null;
  /** True while a draw mode is active (gives the chip an "armed" look). */
  drawing?: boolean;
  onClear: () => void;
  onStartDraw: (kind: "circle" | "polygon") => void;
}

/**
 * Omnibox chip for the map Area filter. With no area set it opens a small menu
 * to pick a draw tool (Polygon or Circle); once an area exists it becomes a
 * clear button. Replaces the old hidden "left-click = polygon, right-click =
 * circle" mechanic, which was undiscoverable.
 */
export function AreaDrawChip({ area, drawing, onClear, onStartDraw }: AreaDrawChipProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  if (area) {
    return (
      <button
        className="flex items-center gap-1 rounded-full border border-emerald-400/70 bg-emerald-400/15 px-2 py-0.5 text-xs"
        onClick={onClear}
        title="Clear Area"
      >
        <MapPinned className="h-3 w-3" /> area <X className="h-3 w-3" />
      </button>
    );
  }

  const pick = (kind: "circle" | "polygon") => {
    setOpen(false);
    onStartDraw(kind);
  };

  return (
    <div ref={wrapRef} className="relative">
      <button
        className={
          "flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs " +
          (drawing ? "border-sky-400/70 bg-sky-400/15" : "border-[var(--line)] opacity-60")
        }
        onClick={() => setOpen((v) => !v)}
        title="Draw an Area on the map to filter results by location"
      >
        <MapPinned className="h-3 w-3" /> {drawing ? "drawing…" : "area"}
        <ChevronDown className="h-3 w-3" />
      </button>

      {open ? (
        <div className="absolute right-0 top-full z-30 mt-1 w-40 rounded-lg border border-[var(--line)] bg-[var(--bg-paper)] p-1 shadow-lg">
          <button
            type="button"
            onClick={() => pick("polygon")}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-[var(--bg-sand)]"
          >
            <Pentagon className="h-3.5 w-3.5" /> Polygon
          </button>
          <button
            type="button"
            onClick={() => pick("circle")}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-[var(--bg-sand)]"
          >
            <Circle className="h-3.5 w-3.5" /> Circle
          </button>
        </div>
      ) : null}
    </div>
  );
}
