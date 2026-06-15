import { useState } from "react";
import { useNavigate } from "react-router-dom";

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
import { useBagsState } from "../hooks/use-bags";
import { useFleetTracks } from "../hooks/use-fleet-tracks";
import { useOmniboxSearch } from "../hooks/use-omnibox-search";
import type { SearchResult } from "../api/types";

export function MapHomePage() {
  const navigate = useNavigate();
  const bagsState = useBagsState();
  const indexedPaths = bagsState.bags.filter((b) => b.is_indexed).map((b) => b.bag_path);
  const { tracks } = useFleetTracks(indexedPaths);
  const [hoveredBagPath, setHoveredBagPath] = useState<string | null>(null);
  const [drawMode, setDrawMode] = useState<"circle" | "polygon" | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [supportDialogOpen, setSupportDialogOpen] = useState(false);
  const [extractTarget, setExtractTarget] = useState<SearchResult | null>(null);
  const [trackPreview, setTrackPreview] = useState<SearchResult | null>(null);
  const search = useOmniboxSearch();

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
        supportDialogOpen={supportDialogOpen}
        onSupportDialogOpenChange={setSupportDialogOpen}
        className="absolute left-1/2 top-4 z-20 w-[min(1080px,94vw)] -translate-x-1/2"
      />
      <ResultsRail
        results={search.results}
        selectedIndex={lightboxIndex}
        onSelect={setLightboxIndex}
        onLoadMore={search.loadMore}
        isSearching={search.isSearching}
        className="absolute inset-x-4 bottom-4 z-10"
      />
      <MapSidePanel
        bags={bagsState.bags}
        locatedOrder={tracks.map((t) => t.bag_path)}
        rootDir={bagsState.rootDir}
        setRootDir={bagsState.setRootDir}
        isScanning={bagsState.isScanning}
        onScan={bagsState.onScan}
        onIndex={bagsState.onIndex}
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
