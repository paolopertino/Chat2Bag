import { Polyline } from "react-leaflet";
import type { TrackPoint } from "../../api/types";

const COLORS = ["#2563eb", "#dc2626", "#16a34a", "#9333ea", "#ea580c"];

export function BagTrajectories({ tracks }: { tracks: TrackPoint[][] }) {
  return (
    <>
      {tracks.map((pts, i) =>
        pts.length > 1 ? (
          <Polyline key={i} positions={pts.map((p) => [p.lat, p.lon] as [number, number])}
            pathOptions={{ color: COLORS[i % COLORS.length], weight: 3, opacity: 0.8 }} />
        ) : null,
      )}
    </>
  );
}
