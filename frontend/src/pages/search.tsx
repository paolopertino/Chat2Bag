import { Crosshair, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import type { Point, SearchResult } from "../api/types";
import { ResultsGrid } from "../components/search/results-grid";
import { BagPickerChip } from "../components/search/bag-picker-chip";
import { FilterChip } from "../components/search/filter-chip";
import { RegionResultLightbox } from "../components/search/region-result-lightbox";
import { RegionSupportChip } from "../components/search/region-support-chip";
import { RegionSupportDialog, type RegionSupport } from "../components/search/region-support-dialog";
import { SearchInput } from "../components/search/search-input";
import { SearchModeToggle, type SearchMode } from "../components/search/search-mode-toggle";
import { Button } from "../components/ui/button";
import { useBags } from "../context/bags-context";
import { useRegionSearch } from "../hooks/use-region-search";
import { useUrlSearch } from "../hooks/use-url-search";
import { encodeBagId } from "../lib/bag-id";

const EXAMPLES = ["pedestrian on the crosswalk", "parked car", "traffic light"];

export function SearchPage() {
  const { bags } = useBags();
  const indexedCount = bags.filter((b) => b.is_indexed).length;
  const noBagsScanned = bags.length === 0;
  const allUnindexed = bags.length > 0 && indexedCount === 0;

  const [searchParams, setSearchParams] = useSearchParams();
  const mode: SearchMode = searchParams.get("mode") === "region" ? "region" : "global";

  const search = useUrlSearch();
  const region = useRegionSearch();

  const [globalDraft, setGlobalDraft] = useState(search.q);
  const [regionDraft, setRegionDraft] = useState("");

  // Region support being edited in the dialog.
  const [editingSupport, setEditingSupport] = useState<RegionSupport | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogInitialPoints, setDialogInitialPoints] = useState<Point[]>([]);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  // Keep the global draft in sync when the URL q changes externally.
  useEffect(() => {
    setGlobalDraft(search.q);
  }, [search.q]);

  // In region mode, ensure no stale global query keeps fetching in the background.
  useEffect(() => {
    if (mode === "region" && (search.q !== "" || search.similar !== "")) search.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, search.q, search.similar]);

  const getResultHref = (result: SearchResult) =>
    `/bags/${encodeBagId(result.bag_path)}?t=${result.timestamp_ns}`;

  const handleSimilar = (result: SearchResult) => {
    search.submitSimilar(result.file_path);
  };

  const setMode = (next: SearchMode) => {
    // Single atomic URL write: setting mode and clearing the global query in two
    // separate setSearchParams calls would race (each recomputes from its own stale
    // snapshot, last write wins) and clobber ?mode=region. So do it in one params object.
    const params = new URLSearchParams(searchParams);
    if (next === "region") {
      params.set("mode", "region");
      params.delete("q");
      params.delete("similar");
    } else {
      params.delete("mode");
    }
    setSearchParams(params, { replace: false });
    if (next === "region") {
      setGlobalDraft("");
    } else {
      region.clear();
      setRegionDraft("");
      setLightboxIndex(null);
    }
  };

  // --- Region handlers ---
  const handleRegionUpload = (file: File) => {
    const objectUrl = URL.createObjectURL(file);
    setEditingSupport({ kind: "image", file, objectUrl });
    setDialogInitialPoints([]);
    setDialogOpen(true);
  };

  const handleEditSupport = () => {
    if (!region.query || region.query.kind === "text") return;
    if (region.query.kind === "image") {
      setEditingSupport({ kind: "image", file: region.query.file, objectUrl: region.query.objectUrl });
    } else {
      setEditingSupport({ kind: "frame", filePath: region.query.filePath });
    }
    setDialogInitialPoints(region.query.points);
    setDialogOpen(true);
  };

  const handlePromote = (result: SearchResult) => {
    setLightboxIndex(null);
    setEditingSupport({ kind: "frame", filePath: result.file_path });
    setDialogInitialPoints([]);
    setDialogOpen(true);
  };

  const handleConfirmSupport = (points: Point[]) => {
    setDialogOpen(false);
    if (!editingSupport) return;
    if (editingSupport.kind === "image") {
      region.runImage(editingSupport.file, editingSupport.objectUrl, points, search.bagPaths, search.topK);
    } else {
      region.runFrame(editingSupport.filePath, points, search.bagPaths, search.topK);
    }
  };

  const openLightbox = (result: SearchResult) => {
    const filtered = region.results.filter((r) => r.similarity_score >= search.minScore);
    const i = filtered.findIndex(
      (r) => r.file_path === result.file_path && r.timestamp_ns === result.timestamp_ns,
    );
    if (i >= 0) setLightboxIndex(i);
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

  const regionResults = region.results.filter((r) => r.similarity_score >= search.minScore);
  const hasGlobalQuery = search.q !== "" || search.similar !== "";
  const hasRegionQuery = region.query !== null;
  const hidden = search.rawResultCount - search.results.length;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <SearchModeToggle mode={mode} onChange={setMode} />
        <div className="flex-1">
          {mode === "global" ? (
            <SearchInput
              value={globalDraft}
              placeholder={`Search across ${indexedCount} indexed bag${indexedCount === 1 ? "" : "s"}`}
              onChange={setGlobalDraft}
              onSubmit={(text) => {
                if (allUnindexed) {
                  toast.error("Index at least one bag to search.");
                  return;
                }
                search.submitText(text);
              }}
              onClear={() => {
                setGlobalDraft("");
                search.clear();
              }}
              onImageUpload={(file) => void search.submitImage(file)}
            />
          ) : (
            <SearchInput
              value={regionDraft}
              placeholder="Describe a region, or upload / promote an image"
              onChange={setRegionDraft}
              onSubmit={(text) => {
                if (allUnindexed) {
                  toast.error("Index at least one bag to search.");
                  return;
                }
                region.runText(text, search.bagPaths, search.topK);
              }}
              onClear={() => setRegionDraft("")}
              onImageUpload={handleRegionUpload}
            />
          )}
        </div>
        <BagPickerChip selectedBagIds={search.urlBags} onChange={(ids) => search.setBags(ids)} />
      </div>

      {mode === "region" && region.query && region.query.kind !== "text" ? (
        <RegionSupportChip
          thumbnailUrl={region.query.kind === "image" ? region.query.objectUrl : null}
          pointCount={region.query.points.length}
          onEdit={handleEditSupport}
          onClear={() => region.clear()}
        />
      ) : null}

      {(mode === "global" && hasGlobalQuery) || (mode === "region" && hasRegionQuery) ? (
        <FilterChip
          topK={search.topK}
          minScore={search.minScore}
          rawResultCount={mode === "global" ? search.rawResultCount : region.results.length}
          bagCount={search.bagPaths.length || indexedCount}
          onTopKChange={search.setTopK}
          onMinScoreChange={search.setMinScore}
        />
      ) : null}

      {mode === "global" ? (
        !hasGlobalQuery ? (
          <EmptyState
            indexedCount={indexedCount}
            onPick={(text) => {
              setGlobalDraft(text);
              search.submitText(text);
            }}
          />
        ) : search.isSearching ? (
          <ResultsGrid results={[]} isSearching getResultHref={getResultHref} />
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
        )
      ) : region.unavailable ? (
        <p className="py-12 text-center text-sm text-[var(--ink-soft)]">
          Region search isn't available with the current backend. Re-index with a dense-capable embedder to enable it.
        </p>
      ) : !hasRegionQuery ? (
        <RegionEmptyState
          onPick={(text) => {
            setRegionDraft(text);
            region.runText(text, search.bagPaths, search.topK);
          }}
        />
      ) : region.isSearching ? (
        <ResultsGrid results={[]} isSearching />
      ) : regionResults.length === 0 ? (
        <p className="py-12 text-center text-sm text-[var(--ink-soft)]">No matching regions found.</p>
      ) : (
        <ResultsGrid
          results={regionResults}
          isSearching={false}
          onResultClick={openLightbox}
          onUseAsRegionSupport={handlePromote}
        />
      )}

      <RegionSupportDialog
        open={dialogOpen}
        support={editingSupport}
        initialPoints={dialogInitialPoints}
        onClose={() => setDialogOpen(false)}
        onConfirm={handleConfirmSupport}
      />

      {lightboxIndex !== null && regionResults[lightboxIndex] ? (
        <RegionResultLightbox
          results={regionResults}
          index={lightboxIndex}
          onIndexChange={setLightboxIndex}
          onClose={() => setLightboxIndex(null)}
          fetchHeatmap={region.fetchHeatmap}
          getResultHref={getResultHref}
          onUseAsRegionSupport={handlePromote}
        />
      ) : null}
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

function RegionEmptyState({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="py-16 text-center">
      <Crosshair className="mx-auto mb-3 h-8 w-8 text-[var(--ink-soft)]" />
      <h2 className="text-base font-semibold">Find a specific region</h2>
      <p className="mt-1 text-sm text-[var(--ink-soft)]">
        Describe it, or use the image button to upload / mark points on a support image.
      </p>
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
