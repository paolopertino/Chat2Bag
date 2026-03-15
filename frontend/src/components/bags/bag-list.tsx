import { LoaderCircle } from "lucide-react";

import type { BagInfo, BagStatus } from "../../api/types";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Separator } from "../ui/separator";

interface BagListProps {
  bags: BagInfo[];
  selectedBagPaths: string[];
  onToggleBag: (bagPath: string) => void;
  onToggleAllBags: () => void;
  onIndex: (bagPath: string) => void;
}

function statusToVariant(status: BagStatus): "idle" | "indexing" | "done" | "error" {
  return status;
}

export function BagList({ bags, selectedBagPaths, onToggleBag, onToggleAllBags, onIndex }: BagListProps) {
  if (bags.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--line)] p-4 text-sm text-[var(--ink-soft)]">
        No bags found yet. Scan a root directory to list available bag folders.
      </div>
    );
  }

  const allSelected = selectedBagPaths.length === bags.length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between rounded-xl border border-[var(--line)] bg-white/70 px-3 py-2 text-sm">
        <p className="text-[var(--ink-soft)]">{selectedBagPaths.length} of {bags.length} selected</p>
        <Button size="sm" variant="ghost" onClick={onToggleAllBags}>
          {allSelected ? "Deselect all" : "Select all"}
        </Button>
      </div>

      {bags.map((bag) => {
        const checked = selectedBagPaths.includes(bag.bag_path);
        const isIndexing = bag.status === "indexing";

        return (
          <div key={bag.bag_path} className="rounded-xl border border-[var(--line)] bg-white p-3">
            <div className="mb-3 flex items-start justify-between gap-3">
              <label className="flex min-w-0 cursor-pointer items-start gap-2">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggleBag(bag.bag_path)}
                  className="mt-1 h-4 w-4 rounded border-[var(--line)] accent-[var(--teal)]"
                />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{bag.bag_name}</p>
                  <p className="truncate font-mono text-[11px] text-[var(--ink-soft)]">{bag.bag_path}</p>
                </div>
              </label>
              <Badge variant={statusToVariant(bag.status)}>{bag.status}</Badge>
            </div>

            <Separator className="mb-3" />

            <Button
              size="sm"
              variant="secondary"
              disabled={isIndexing}
              onClick={() => onIndex(bag.bag_path)}
            >
              {isIndexing ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : null}
              {isIndexing ? "Indexing" : bag.is_indexed ? "Re-index" : "Index"}
            </Button>
          </div>
        );
      })}
    </div>
  );
}
