import { Crosshair, MapPinned, X } from "lucide-react";
import { useState } from "react";

import type { OmniboxSearch, SupportSource } from "../../hooks/use-omnibox-search";
import { BagPickerChip } from "../search/bag-picker-chip";
import { FilterChip } from "../search/filter-chip";
import { RegionSupportDialog, type RegionSupport } from "../search/region-support-dialog";
import { SearchInput } from "../search/search-input";
import { SupportChip } from "./support-chip";

interface OmniboxProps {
  search: OmniboxSearch;
  /** Hidden in the Bag viewer (no map to draw on). */
  showAreaChip?: boolean;
  /** Hidden in the Bag viewer (scope is pinned). */
  showBagChip?: boolean;
  onStartAreaDraw?: (kind: "circle" | "polygon") => void;
  /** Lifted state: controls the support dialog from outside (e.g. after "Use as region support"). */
  supportDialogOpen?: boolean;
  onSupportDialogOpenChange?: (open: boolean) => void;
  className?: string;
}

export function Omnibox({
  search,
  showAreaChip = true,
  showBagChip = true,
  onStartAreaDraw,
  supportDialogOpen: externalDialogOpen,
  onSupportDialogOpenChange,
  className,
}: OmniboxProps) {
  const [internalDialogOpen, setInternalDialogOpen] = useState(false);
  const dialogOpen = externalDialogOpen ?? internalDialogOpen;
  const setDialogOpen = (open: boolean) => {
    setInternalDialogOpen(open);
    onSupportDialogOpenChange?.(open);
  };

  // Convert SupportSource to the RegionSupportDialog's RegionSupport format
  function toRegionSupport(s: SupportSource | null): RegionSupport | null {
    if (!s) return null;
    if (s.kind === "upload") return { kind: "image", file: s.file, objectUrl: s.objectUrl };
    return { kind: "frame", frames: s.frames, selectedFilePath: s.filePath };
  }

  return (
    <div className={className}>
      <div className="flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--glass)] px-3 py-1.5 shadow-lg backdrop-blur">
        <div className="min-w-0 flex-1">
          <SearchInput
            value={search.text}
            placeholder={
              search.support
                ? "press Enter to search with the attached image"
                : "search frames… (attach an image, or draw an Area and press Enter)"
            }
            onChange={search.setText}
            onSubmit={() => search.submit()}
            canSubmit={Boolean(search.text.trim() || search.support || search.area)}
            onClear={() => search.clear()}
            onImageUpload={(file) => {
              search.setSupport({ kind: "upload", file, objectUrl: URL.createObjectURL(file) });
              setDialogOpen(true);
            }}
          />
        </div>

        {search.support ? (
          <SupportChip
            pointCount={search.points.length}
            onEdit={() => setDialogOpen(true)}
            onClear={() => search.setSupport(null)}
          />
        ) : (
          <button
            className={
              "flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs " +
              (search.regionMode
                ? "border-sky-400/70 bg-sky-400/15"
                : "border-[var(--line)] opacity-60")
            }
            onClick={() => search.setRegionMode(!search.regionMode)}
            title="Region search: rank by the best-matching Patch instead of the whole Frame"
          >
            <Crosshair className="h-3 w-3" /> region
          </button>
        )}

        {showAreaChip ? (
          search.area ? (
            <button
              className="flex items-center gap-1 rounded-full border border-emerald-400/70 bg-emerald-400/15 px-2 py-0.5 text-xs"
              onClick={() => search.setArea(null)}
              title="Clear Area"
            >
              <MapPinned className="h-3 w-3" /> area <X className="h-3 w-3" />
            </button>
          ) : (
            <button
              className="flex items-center gap-1 rounded-full border border-[var(--line)] px-2 py-0.5 text-xs opacity-60"
              onClick={() => onStartAreaDraw?.("polygon")}
              title="Draw an Area on the map (right-click for circle)"
              onContextMenu={(e) => {
                e.preventDefault();
                onStartAreaDraw?.("circle");
              }}
            >
              <MapPinned className="h-3 w-3" /> area
            </button>
          )
        ) : null}

        {showBagChip ? (
          <BagPickerChip
            selectedBagIds={search.urlBags}
            onChange={search.setBags}
          />
        ) : null}

        <FilterChip
          topK={search.topK}
          minScore={search.minScore}
          rawResultCount={search.rawResultCount}
          bagCount={search.bagPaths.length}
          onTopKChange={search.setTopK}
          onMinScoreChange={search.setMinScore}
        />
      </div>

      {dialogOpen && search.support ? (
        <RegionSupportDialog
          open={dialogOpen}
          support={toRegionSupport(search.support)}
          initialPoints={search.points}
          onClose={() => setDialogOpen(false)}
          onConfirm={(points, chosenFilePath) => {
            setDialogOpen(false);
            search.submitSupportRegion(points, chosenFilePath);
          }}
        />
      ) : null}
    </div>
  );
}
