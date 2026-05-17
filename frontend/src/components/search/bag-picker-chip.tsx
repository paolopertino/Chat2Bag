import { ChevronDown, Folder } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

import type { BagInfo } from "../../api/types";
import { useBags } from "../../context/bags-context";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { encodeBagId } from "../../lib/bag-id";

interface BagPickerChipProps {
  /** Bag IDs (encoded) currently selected. Empty array = "all indexed". */
  selectedBagIds: string[];
  onChange: (bagIds: string[]) => void;
}

export function BagPickerChip({ selectedBagIds, onChange }: BagPickerChipProps) {
  const { bags } = useBags();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const popoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const indexedBags = useMemo(() => bags.filter((b) => b.is_indexed), [bags]);

  const indexedBagIds = useMemo(
    () => indexedBags.map((b) => encodeBagId(b.bag_path)),
    [indexedBags],
  );

  // "Empty selectedBagIds" means "all indexed" by convention.
  const effectiveSelection = useMemo<Set<string>>(() => {
    if (selectedBagIds.length === 0) return new Set(indexedBagIds);
    return new Set(selectedBagIds);
  }, [selectedBagIds, indexedBagIds]);

  const filteredBags = useMemo(() => {
    if (!filter) return bags;
    const f = filter.toLowerCase();
    return bags.filter((b) => b.bag_name.toLowerCase().includes(f));
  }, [bags, filter]);

  const toggleBag = (bag: BagInfo) => {
    if (!bag.is_indexed) return;
    const id = encodeBagId(bag.bag_path);
    const next = new Set(effectiveSelection);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    // Normalize back to [] if selection equals "all indexed".
    if (next.size === indexedBagIds.length && indexedBagIds.every((x) => next.has(x))) {
      onChange([]);
    } else {
      onChange(Array.from(next));
    }
  };

  const selectAll = () => onChange([]);

  const selectedCount = effectiveSelection.size;

  return (
    <div className="relative">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen((v) => !v)}
        className="gap-1.5"
      >
        <Folder className="h-3.5 w-3.5" />
        {`${selectedCount} bag${selectedCount === 1 ? "" : "s"}`}
        <ChevronDown className="h-3.5 w-3.5" />
      </Button>

      {open ? (
        <div
          ref={popoverRef}
          className="absolute right-0 top-full z-30 mt-1 w-[320px] rounded-lg border border-[var(--line)] bg-[var(--bg-paper)] p-3 shadow-lg"
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold">Search in</span>
            <span className="text-[11px] text-[var(--ink-soft)]">
              {selectedCount} / {indexedBagIds.length} selected
            </span>
          </div>

          <Input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter bags…"
            className="mb-2 h-7 text-xs"
          />

          <div className="mb-2 flex gap-3 text-[11px]">
            <button
              type="button"
              onClick={selectAll}
              className="text-[var(--teal)] hover:underline"
            >
              Use all indexed
            </button>
            <button
              type="button"
              onClick={selectAll}
              className="text-[var(--ink-soft)] hover:underline"
            >
              Clear
            </button>
          </div>

          <div className="max-h-72 overflow-y-auto border-t border-[var(--line)] pt-2">
            {filteredBags.length === 0 ? (
              <p className="py-2 text-center text-xs text-[var(--ink-soft)]">No bags match.</p>
            ) : (
              filteredBags.map((bag) => {
                const id = encodeBagId(bag.bag_path);
                const checked = effectiveSelection.has(id);
                const disabled = !bag.is_indexed;
                return (
                  <label
                    key={bag.bag_path}
                    className={`flex items-center gap-2 py-1 text-xs ${
                      disabled
                        ? "cursor-not-allowed opacity-50"
                        : "cursor-pointer hover:bg-[var(--bg-sand)]"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked && !disabled}
                      disabled={disabled}
                      onChange={() => toggleBag(bag)}
                      className="accent-[var(--teal)]"
                    />
                    <span className="flex-1 truncate font-mono">{bag.bag_name}</span>
                    <Badge
                      variant={bag.is_indexed ? "default" : "outline"}
                      className="text-[10px]"
                    >
                      {bag.status}
                    </Badge>
                  </label>
                );
              })
            )}
          </div>

          <div className="mt-2 border-t border-[var(--line)] pt-2 text-[11px]">
            <Link to="/bags" className="text-[var(--teal)] hover:underline">
              → Manage bags &amp; scan more
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
