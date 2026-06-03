import { Image as ImageIcon, X } from "lucide-react";

interface RegionSupportChipProps {
  thumbnailUrl: string | null;
  pointCount: number;
  onEdit: () => void;
  onClear: () => void;
}

export function RegionSupportChip({ thumbnailUrl, pointCount, onEdit, onClear }: RegionSupportChipProps) {
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--bg-paper)] py-1 pl-1 pr-2 text-xs">
      <button type="button" onClick={onEdit} className="flex items-center gap-2" title="Edit region points">
        {thumbnailUrl ? (
          <img src={thumbnailUrl} alt="Support" className="h-6 w-6 rounded-full object-cover" />
        ) : (
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--bg-sand)]">
            <ImageIcon className="h-3.5 w-3.5" />
          </span>
        )}
        <span>{pointCount} point{pointCount === 1 ? "" : "s"}</span>
      </button>
      <button
        type="button"
        onClick={onClear}
        title="Clear region support"
        aria-label="Clear region support"
        className="text-[var(--ink-soft)] hover:text-[var(--ink)]"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
