import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { Omnibox } from "../components/omnibox/omnibox";
import { FleetTracksLayer } from "../components/map/fleet-tracks-layer";
import { MapLibreMap } from "../components/map/maplibre-map";
import { MapSidePanel } from "../components/map/map-side-panel";
import { encodeBagId } from "../lib/bag-id";
import { useBagsState } from "../hooks/use-bags";
import { useFleetTracks } from "../hooks/use-fleet-tracks";
import { useOmniboxSearch } from "../hooks/use-omnibox-search";

export function MapHomePage() {
  const navigate = useNavigate();
  const bagsState = useBagsState();
  const indexedPaths = bagsState.bags.filter((b) => b.is_indexed).map((b) => b.bag_path);
  const { tracks } = useFleetTracks(indexedPaths);
  const [hoveredBagPath, setHoveredBagPath] = useState<string | null>(null);
  const [drawMode, setDrawMode] = useState<"circle" | "polygon" | null>(null);
  const search = useOmniboxSearch();

  void drawMode; // wired to AreaDraw in Task 11

  const openBag = (bagPath: string) => navigate(`/bags/${encodeBagId(bagPath)}`);

  return (
    <div className="absolute inset-0">
      <MapLibreMap>
        <FleetTracksLayer
          tracks={tracks}
          hoveredBagPath={hoveredBagPath}
          onTrackClick={openBag}
        />
      </MapLibreMap>
      <Omnibox
        search={search}
        onStartAreaDraw={setDrawMode}
        className="absolute left-1/2 top-4 z-20 w-[min(760px,92vw)] -translate-x-1/2"
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
        jobsTab={null}
      />
    </div>
  );
}
