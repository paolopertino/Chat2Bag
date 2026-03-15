import { Search } from "lucide-react";

import { Button } from "../ui/button";
import { Input } from "../ui/input";

interface SearchBarProps {
  query: string;
  onQueryChange: (value: string) => void;
  topK: number;
  onTopKChange: (value: number) => void;
  onSearch: () => void;
  isSearching: boolean;
  selectedBagCount: number;
}

export function SearchBar({
  query,
  onQueryChange,
  topK,
  onTopKChange,
  onSearch,
  isSearching,
  selectedBagCount,
}: SearchBarProps) {
  return (
    <div className="rounded-2xl border border-[var(--line)] bg-white/95 p-4 shadow-soft">
      <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center">
        <Input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onSearch();
            }
          }}
          placeholder="Try: a red car, a bus, crosswalk with pedestrians..."
          className="h-11 text-base"
        />
        <Button onClick={onSearch} disabled={isSearching || selectedBagCount === 0} className="h-11 min-w-32">
          <Search className="mr-2 h-4 w-4" />
          {isSearching ? "Searching" : "Search"}
        </Button>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-[var(--ink-soft)]">Searching across {selectedBagCount} selected bag(s)</p>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-[var(--ink-soft)]">Top results</span>
          <Input
            type="number"
            min={1}
            max={100}
            value={topK}
            onChange={(event) => onTopKChange(Number(event.target.value) || 1)}
            className="h-9 w-24"
          />
        </label>
      </div>
    </div>
  );
}
