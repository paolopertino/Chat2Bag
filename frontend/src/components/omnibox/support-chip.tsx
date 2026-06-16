import { X } from "lucide-react";

interface SupportChipProps {
  pointCount: number;
  onEdit: () => void;
  onClear: () => void;
}

export function SupportChip({ pointCount, onEdit, onClear }: SupportChipProps) {
  return (
    <button
      type="button"
      className="flex items-center gap-1 rounded-full border border-amber-400/60 bg-amber-400/10 px-2 py-0.5 text-xs"
      onClick={onEdit}
      title="Edit Region points"
    >
      support · {pointCount} pts
      <X
        className="h-3 w-3"
        onClick={(e) => {
          e.stopPropagation();
          onClear();
        }}
      />
    </button>
  );
}
