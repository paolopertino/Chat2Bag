import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { X } from "lucide-react";

import { Omnibox } from "../components/omnibox/omnibox";
import { AreaDraw } from "../components/map/area-draw";
import { BasemapToggle } from "../components/map/basemap-toggle";
import { AreaDisplayLayer } from "../components/map/area-display-layer";
import { FleetTracksLayer } from "../components/map/fleet-tracks-layer";
import { MapLibreMap } from "../components/map/maplibre-map";
import { MapSidePanel } from "../components/map/map-side-panel";
import { ResultPinsLayer } from "../components/map/result-pins-layer";
import { ResultsRail } from "../components/search/results-rail";
import { SampleResultLightbox } from "../components/search/sample-result-lightbox";
import { ExtractDialog } from "../components/extract/extract-dialog";
import { JobsTab } from "../components/map/jobs-tab";
import { encodeBagId } from "../lib/bag-id";
import { useBags } from "../context/bags-context";
import { useFleetTracks } from "../hooks/use-fleet-tracks";
import { useOmniboxSearch } from "../hooks/use-omnibox-search";
import type { SearchResult } from "../api/types";

export function MapHomePage() {
  const navigate = useNavigate();
  const bagsState = useBags();
  const { tracks } = useFleetTracks(bagsState.visibleIndexedBagPaths);
  const [hoveredBagPath, setHoveredBagPath] = useState<string | null>(null);
  const [drawMode, setDrawMode] = useState<"circle" | "polygon" | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [supportDialogOpen, setSupportDialogOpen] = useState(false);
  const [extractTarget, setExtractTarget] = useState<SearchResult | null>(null);
  const [trackPreview, setTrackPreview] = useState<SearchResult | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const search = useOmniboxSearch();

  // Esc exits an armed draw tool entirely (terra-draw's own Esc only clears the
  // in-progress geometry but stays in the mode).
  useEffect(() => {
    if (!drawMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawMode(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawMode]);

  const openBag = (bagPath: string, timestampNs?: number) =>
    navigate(`/bags/${encodeBagId(bagPath)}${timestampNs != null ? `?t=${timestampNs}` : ""}`);

  // Clicking a track previews the nearest point in the lightbox (rather than
  // jumping straight into the bag viewer); the lightbox's "Open in Explorer"
  // then enters the bag viewer at that timestamp.
  const openTrackPreview = (bagPath: string, timestampNs?: number) => {
    const bagName = bagPath.replace(/\/+$/, "").split("/").pop() ?? bagPath;
    setTrackPreview({
      bag_path: bagPath,
      timestamp_ns: timestampNs ?? 0,
      file_path: "",
      topic: "",
      source_bag: bagName,
    });
  };

  return (
    <div className="absolute inset-0">
      <MapLibreMap>
        <FleetTracksLayer
          tracks={tracks}
          hoveredBagPath={hoveredBagPath}
          onTrackClick={openTrackPreview}
        />
        <AreaDraw mode={drawMode} onArea={search.setArea} onDone={() => setDrawMode(null)} />
        <AreaDisplayLayer area={search.area} />
        <ResultPinsLayer results={search.results} onPinClick={setLightboxIndex} />
        <BasemapToggle />
      </MapLibreMap>
      <Omnibox
        search={search}
        onStartAreaDraw={setDrawMode}
        drawMode={drawMode}
        supportDialogOpen={supportDialogOpen}
        onSupportDialogOpenChange={setSupportDialogOpen}
        className="absolute left-1/2 top-4 z-20 w-[min(1080px,94vw)] -translate-x-1/2"
      />
      {drawMode ? (
        <div className="absolute left-1/2 top-20 z-20 flex -translate-x-1/2 items-center gap-3 rounded-full border border-sky-400/40 bg-[var(--glass)] px-4 py-1.5 text-xs shadow-lg backdrop-blur">
          <span className="text-[var(--ink)]">
            {drawMode === "circle"
              ? "Click to place the center, then click again to set the radius."
              : "Click to add points; click the first point or press Enter to finish."}
          </span>
          <button
            onClick={() => setDrawMode(null)}
            className="flex items-center gap-1 text-[var(--ink-soft)] hover:text-[var(--ink)]"
            title="Cancel drawing (Esc)"
          >
            <X className="h-3 w-3" /> cancel
          </button>
        </div>
      ) : null}
      <ResultsRail
        results={search.results}
        selectedIndex={lightboxIndex}
        onSelect={setLightboxIndex}
        onLoadMore={search.loadMore}
        isSearching={search.isSearching}
        className="absolute inset-x-4 bottom-4 z-10"
      />
      <MapSidePanel
        open={sidebarOpen}
        onOpenChange={setSidebarOpen}
        bags={bagsState.bags}
        root={bagsState.scannedRoot}
        locatedOrder={tracks.map((t) => t.bag_path)}
        rootDir={bagsState.rootDir}
        setRootDir={bagsState.setRootDir}
        isScanning={bagsState.isScanning}
        onScan={bagsState.onScan}
        onIndex={bagsState.onIndex}
        onRetry={bagsState.onRetry}
        isBagHidden={bagsState.isBagHidden}
        onToggleBagVisibility={bagsState.toggleBagVisibility}
        onSetGroupHidden={bagsState.setBagsHidden}
        onHoverBag={setHoveredBagPath}
        onOpenBag={openBag}
        jobsTab={<JobsTab />}
      />
      {lightboxIndex !== null && search.results[lightboxIndex] ? (
        <SampleResultLightbox
          results={search.results}
          index={lightboxIndex}
          onIndexChange={setLightboxIndex}
          onClose={() => setLightboxIndex(null)}
          fetchHeatmap={search.activeKind === "region" ? search.fetchHeatmap : undefined}
          getResultHref={(r) => `/bags/${encodeBagId(r.bag_path)}?t=${r.timestamp_ns}`}
          onUseAsRegionSupport={(frames, selectedFilePath) => {
            search.setSupport({ kind: "frame", filePath: selectedFilePath, frames });
            setSupportDialogOpen(true);
            setLightboxIndex(null);
          }}
          onExtract={setExtractTarget}
          onOpenInBag={(r) =>
            navigate(`/bags/${encodeBagId(r.bag_path)}?t=${r.timestamp_ns}`, {
              state: { results: search.results },
            })
          }
        />
      ) : null}
      {trackPreview ? (
        <SampleResultLightbox
          results={[trackPreview]}
          index={0}
          onIndexChange={() => {}}
          onClose={() => setTrackPreview(null)}
          getResultHref={(r) => `/bags/${encodeBagId(r.bag_path)}?t=${r.timestamp_ns}`}
          onUseAsRegionSupport={(frames, selectedFilePath) => {
            search.setSupport({ kind: "frame", filePath: selectedFilePath, frames });
            setSupportDialogOpen(true);
            setTrackPreview(null);
          }}
          onExtract={setExtractTarget}
          onOpenInBag={(r) => navigate(`/bags/${encodeBagId(r.bag_path)}?t=${r.timestamp_ns}`)}
        />
      ) : null}
      {extractTarget ? (
        <ExtractDialog
          bagPath={extractTarget.bag_path}
          timestampNs={extractTarget.timestamp_ns}
          open
          onOpenChange={(o) => { if (!o) setExtractTarget(null); }}
        />
      ) : null}
    </div>
  );
}
