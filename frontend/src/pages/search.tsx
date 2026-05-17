import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import type { SearchResult } from "../api/types";
import { ResultsGrid } from "../components/search/results-grid";
import { BagPickerChip } from "../components/search/bag-picker-chip";
import { FilterChip } from "../components/search/filter-chip";
import { SearchInput } from "../components/search/search-input";
import { Button } from "../components/ui/button";
import { useBags } from "../context/bags-context";
import { useUrlSearch } from "../hooks/use-url-search";
import { encodeBagId } from "../lib/bag-id";

const EXAMPLES = ["pedestrian on the crosswalk", "parked car", "traffic light"];

export function SearchPage() {
  const { bags } = useBags();
  const indexedCount = bags.filter((b) => b.is_indexed).length;
  const noBagsScanned = bags.length === 0;
  const allUnindexed = bags.length > 0 && indexedCount === 0;
  const search = useUrlSearch();
  const [draft, setDraft] = useState(search.q);

  // Keep draft in sync when URL q changes externally (browser Back/Forward, example click).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft(search.q);
  }, [search.q]);

  const getResultHref = (result: SearchResult) =>
    `/bags/${encodeBagId(result.bag_path)}?t=${result.timestamp_ns}`;

  const handleSimilar = (result: SearchResult) => {
    search.submitSimilar(result.file_path);
  };

  // No bags scanned at all → hard block with CTA.
  if (noBagsScanned) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <Search className="mx-auto mb-3 h-8 w-8 text-[var(--ink-soft)]" />
        <h2 className="text-base font-semibold">No indexed bags yet</h2>
        <p className="mt-1 text-sm text-[var(--ink-soft)]">
          Scan a directory and index at least one bag before searching.
        </p>
        <Button asChild className="mt-4">
          <Link to="/bags">Go to Bag Explorer</Link>
        </Button>
      </div>
    );
  }

  const hasQuery = search.q !== "" || search.similar !== "";
  const hidden = search.rawResultCount - search.results.length;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <SearchInput
            value={draft}
            placeholder={`Search across ${indexedCount} indexed bag${indexedCount === 1 ? "" : "s"}`}
            onChange={setDraft}
            onSubmit={(text) => {
              if (allUnindexed) {
                toast.error("Index at least one bag to search.");
                return;
              }
              search.submitText(text);
            }}
            onClear={() => {
              setDraft("");
              search.clear();
            }}
            onImageUpload={(file) => void search.submitImage(file)}
          />
        </div>
        <BagPickerChip
          selectedBagIds={search.urlBags}
          onChange={(ids) => search.setBags(ids)}
        />
      </div>

      {hasQuery ? (
        <FilterChip
          topK={search.topK}
          minScore={search.minScore}
          rawResultCount={search.rawResultCount}
          bagCount={search.bagPaths.length || indexedCount}
          onTopKChange={search.setTopK}
          onMinScoreChange={search.setMinScore}
        />
      ) : null}

      {!hasQuery ? (
        <EmptyState
          indexedCount={indexedCount}
          onPick={(text) => {
            setDraft(text);
            search.submitText(text);
          }}
        />
      ) : search.isSearching ? (
        <ResultsGrid results={[]} isSearching={true} getResultHref={getResultHref} />
      ) : search.results.length === 0 && hidden > 0 ? (
        <ZeroAboveThreshold hidden={hidden} onLowerThreshold={() => search.setMinScore(0)} />
      ) : search.results.length === 0 ? (
        <p className="py-12 text-center text-sm text-[var(--ink-soft)]">No matches found.</p>
      ) : (
        <ResultsGrid
          results={search.results}
          isSearching={false}
          getResultHref={getResultHref}
          onSimilarSearch={handleSimilar}
        />
      )}
    </div>
  );
}

function EmptyState({
  indexedCount,
  onPick,
}: {
  indexedCount: number;
  onPick: (text: string) => void;
}) {
  return (
    <div className="py-16 text-center">
      <Search className="mx-auto mb-3 h-8 w-8 text-[var(--ink-soft)]" />
      <h2 className="text-base font-semibold">
        Search across {indexedCount} indexed bag{indexedCount === 1 ? "" : "s"}
      </h2>
      <p className="mt-1 text-sm text-[var(--ink-soft)]">Try one of these examples:</p>
      <div className="mt-3 flex flex-wrap justify-center gap-2">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            onClick={() => onPick(ex)}
            className="rounded-full border border-[var(--line)] bg-[var(--bg-paper)] px-3 py-1 text-xs hover:bg-[var(--bg-sand)]"
          >
            {ex}
          </button>
        ))}
      </div>
    </div>
  );
}

function ZeroAboveThreshold({
  hidden,
  onLowerThreshold,
}: {
  hidden: number;
  onLowerThreshold: () => void;
}) {
  return (
    <div className="py-12 text-center text-sm">
      <p className="text-[var(--ink-soft)]">
        No matches above the current threshold ({hidden} hit{hidden === 1 ? "" : "s"} hidden).
      </p>
      <button
        type="button"
        onClick={onLowerThreshold}
        className="mt-2 text-[var(--teal)] hover:underline"
      >
        Lower the threshold
      </button>
    </div>
  );
}
