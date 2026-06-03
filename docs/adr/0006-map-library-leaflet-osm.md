# Map library: Leaflet + react-leaflet + geoman, raster OSM tiles

Map search needs a full-screen map for the user to click a point (circle) or draw
a polygon **Area**, plus rendering of bag trajectory polylines and clustered
result markers. The frontend has no map library today, and the map component will
be written against whichever one we pick — a hard-ish-to-reverse choice. We choose
**Leaflet + react-leaflet** with **leaflet-geoman** for circle/polygon drawing,
**leaflet.markercluster** for pins, and **raster OpenStreetMap tiles**.

The requirements are modest (click, draw two shapes, draw polylines, cluster
markers), so the deciding factors are setup cost and external dependencies:
Leaflet needs **no API key and no account**, geoman gives both shapes out of the
box, and raster tiles render fine for an internal tool. The tile provider is a
one-line URL swap (Stadia / MapTiler / Carto) if OSM's light-use tile policy ever
becomes a concern.

## Considered alternatives

- **MapLibre GL + a draw plugin.** Vector tiles and smoother zoom/rotation, and a
  better foundation for the future "map as home" UX refactor — but it needs a
  tile/style provider (e.g. a MapTiler key), a separate draw plugin, and WebGL:
  more moving parts than circles + polygons justify now. Revisit during that
  refactor.
- **Google Maps.** Familiar and polished, but requires an API key + billing
  account, tying a self-hosted internal tool to an external paid dependency.
  Rejected on operational burden.
