import { useRef } from "react";
import { ImageUp, Search } from "lucide-react";

import { Button } from "../ui/button";
import { Input } from "../ui/input";

interface SearchBarProps {
  query: string;
  onQueryChange: (value: string) => void;
  topK: number;
  onTopKChange: (value: number) => void;
  onSearch: () => void;
  onImageUpload: (file: File) => void;
  isSearching: boolean;
  selectedBagCount: number;
}

export function SearchBar({
  query,
  onQueryChange,
  topK,
  onTopKChange,
  onSearch,
  onImageUpload,
  isSearching,
  selectedBagCount,
}: SearchBarProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              onImageUpload(file);
            }
            event.target.value = "";
          }}
        />
        <Button
          type="button"
          variant="secondary"
          onClick={() => fileInputRef.current?.click()}
          disabled={isSearching || selectedBagCount === 0}
          className="h-11 min-w-11 px-3"
          aria-label="Upload an image to search"
          title="Upload an image to search"
        >
          <ImageUp className="h-4 w-4" />
        </Button>
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
