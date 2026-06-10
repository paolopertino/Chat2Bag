import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { FleetTracksLayer } from "../components/map/fleet-tracks-layer";
import { MapLibreMap } from "../components/map/maplibre-map";
import { encodeBagId } from "../lib/bag-id";
import { useBagsState } from "../hooks/use-bags";
import { useFleetTracks } from "../hooks/use-fleet-tracks";

export function MapHomePage() {
  const navigate = useNavigate();
  const bagsState = useBagsState();
  const indexedPaths = bagsState.bags.filter((b) => b.is_indexed).map((b) => b.bag_path);
  const { tracks } = useFleetTracks(indexedPaths);
  const [hoveredBagPath, setHoveredBagPath] = useState<string | null>(null);
  void setHoveredBagPath; // wired to the side panel in Task 8

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
    </div>
  );
}
