import { MapPin, X } from "lucide-react";

interface AreaChipProps {
  area: import("../../api/types").Area | null;
  count: number | null;
  disabled?: boolean;
  onEdit: () => void;
  onClear: () => void;
}

export function AreaChip({ area, count, disabled, onEdit, onClear }: AreaChipProps) {
  const label = !area
    ? "Set area on map"
    : area.kind === "circle"
      ? `Area · circle ~${Math.round(area.radius_m)} m${count !== null ? ` · ${count} frames` : ""}`
      : `Area · polygon${count !== null ? ` · ${count} frames` : ""}`;
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--bg-paper)] py-1 pl-2 pr-2 text-xs">
      <button type="button" onClick={onEdit} disabled={disabled} className="flex items-center gap-1.5 disabled:opacity-50" title="Edit area">
        <MapPin className="h-3.5 w-3.5" />
        <span>{label}</span>
      </button>
      {area ? (
        <button type="button" onClick={onClear} title="Clear area" aria-label="Clear area" className="text-[var(--ink-soft)] hover:text-[var(--ink)]">
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
}
