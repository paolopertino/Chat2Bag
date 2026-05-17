// RECOVERY STUB — original was not captured in session logs.
// Original spec: collapsing folder tree of bags, single-child chains collapsed.
// This stub renders a flat list — replace with a real tree when reintegrating.
import { Link } from "react-router-dom";

import type { BagInfo } from "../../api/types";
import { Button } from "../ui/button";
import { encodeBagId } from "../../lib/bag-id";

interface BagTreeProps {
  bags: BagInfo[];
  selectedBagPath?: string | null;
  onIndex?: (bagPath: string) => void;
  compact?: boolean;
}

export function BagTree({ bags, selectedBagPath, onIndex, compact }: BagTreeProps) {
  if (bags.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-[var(--line)] p-3 text-xs text-[var(--ink-soft)]">
        No bags scanned yet.
      </div>
    );
  }
  return (
    <ul className={compact ? "space-y-0.5" : "space-y-1"}>
      {bags.map((bag) => {
        const id = encodeBagId(bag.bag_path);
        const isSelected = selectedBagPath === bag.bag_path;
        return (
          <li key={bag.bag_path} className="flex items-center justify-between gap-2">
            <Link
              to={`/bags/${id}`}
              className={
                "truncate text-xs " +
                (isSelected ? "font-semibold" : "text-[var(--ink-soft)] hover:text-[var(--ink)]")
              }
              title={bag.bag_path}
            >
              {bag.bag_name}
            </Link>
            {!bag.is_indexed && onIndex ? (
              <Button size="sm" variant="ghost" onClick={() => onIndex(bag.bag_path)}>
                index
              </Button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
