import { useEffect, useState } from "react";
import { MapContainer, TileLayer } from "react-leaflet";
import "leaflet/dist/leaflet.css";

import type { Area, TrackPoint } from "../../api/types";
import { countInArea } from "../../lib/area-geo";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";
import { AreaLayer } from "../map/area-layer";
import { BagTrajectories } from "../map/bag-trajectories";

const OSM_TILE_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const DEFAULT_CENTER: [number, number] = [45.88, 10.19];

interface MapAreaDialogProps {
  open: boolean;
  initialArea: Area | null;
  tracks: TrackPoint[][];
  onClose: () => void;
  onConfirm: (area: Area | null) => void;
}

export function MapAreaDialog({ open, initialArea, tracks, onClose, onConfirm }: MapAreaDialogProps) {
  const [draft, setDraft] = useState<Area | null>(initialArea);
  useEffect(() => { setDraft(initialArea); }, [initialArea, open]);

  const count = draft ? countInArea(draft, tracks) : null;
  const center = tracks[0]?.[0] ? [tracks[0][0].lat, tracks[0][0].lon] as [number, number] : DEFAULT_CENTER;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="h-[92vh] max-w-[96vw] overflow-hidden p-0 sm:max-w-[96vw]">
        <DialogHeader className="px-4 pt-4">
          <DialogTitle>Draw a search area</DialogTitle>
          <DialogDescription>Use the circle or polygon tool. Trajectories of the selected bags are shown.</DialogDescription>
        </DialogHeader>
        <div className="h-[70vh] w-full">
          <MapContainer center={center} zoom={15} className="h-full w-full">
            <TileLayer url={OSM_TILE_URL} attribution="&copy; OpenStreetMap contributors" />
            <BagTrajectories tracks={tracks} />
            <AreaLayer area={draft} onChange={setDraft} />
          </MapContainer>
        </div>
        <div className="flex items-center justify-between gap-2 px-4 py-3">
          <span className="text-xs text-[var(--ink-soft)]">
            {draft ? `${count} located frame${count === 1 ? "" : "s"} in area` : "No area drawn"}
          </span>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setDraft(null)} disabled={!draft}>Clear</Button>
            <Button type="button" variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
            <Button type="button" size="sm" onClick={() => onConfirm(draft)} disabled={!draft}>Apply</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
