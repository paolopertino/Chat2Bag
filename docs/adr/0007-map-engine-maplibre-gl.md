# Map engine: MapLibre GL + free vector tiles (supersedes ADR 0006)

Status: accepted — supersedes ADR-0006

The frontend redesign (spec: `2026-06-10-frontend-redesign-design.md`) makes
the map the home surface: every Bag's Track plotted at once, search-result pins
on top, Area drawing inline, and a globe-to-region landing animation. That is a
different workload from ADR 0006's "click and draw two shapes": Leaflet's
DOM/raster rendering strains under fleet-wide polylines plus hundreds of pins,
and it has no globe. We switch to **MapLibre GL** (BSD-3, no key, community
fork of Mapbox GL v1) with **OpenFreeMap** vector tiles (free, no registration)
and **terra-draw** for circle/polygon Areas.

ADR 0006 anticipated exactly this: it chose Leaflet for modest needs and said
to revisit MapLibre "during that refactor". The user constraint was that the
stack stay free and open source — MapLibre and OpenFreeMap both are; a tile
*provider* is the only thing that could ever cost money, and OpenFreeMap (or
self-hosted OpenMapTiles, or plain raster OSM, which MapLibre also renders)
keeps it at zero.

## Consequences

- `BagTrajectories`, `AreaLayer`, and the Area-drawing flow are rewritten
  against MapLibre/terra-draw; leaflet, react-leaflet, geoman, and
  markercluster are removed.
- WebGL is now required of client browsers (acceptable for an internal tool).
