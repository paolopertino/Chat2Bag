# Per-camera frames, no multi-view fusion

Ingestion is expanding from a single `camera_topic` to an arbitrary list of
camera topics. The tempting reading of "synchronized and jointly processed" is a
*fused* multi-view embedding — one vector per synchronized Sample (the vehicle's
full surround at an instant). We reject fusion: the embedded and searched unit
stays a **per-camera Frame** (tagged by its topic), cameras are sampled
independently, and a **Sample** (the synchronized camera rig) is only a
**display-time grouping resolved by nearest-timestamp** — never a stored fused
vector.

**The dilution argument:** fusing N views averages a small entity (the traffic
light in one camera) down to ~1/N of the signal — recreating the exact
whole-frame dissolving problem that motivates Region search, but now across views
instead of regions. Per-camera frames keep Global search sharp and give Region
search a clean per-view substrate to build on later.

## Consequences

- `metadata.json` becomes flat frames carrying a per-frame `topic`, plus a
  `cameras[]` list; thumbnails are namespaced into per-camera subdirectories;
  sampling tracks the FPS interval per topic.
- Visualization sync ("show the whole rig around this hit") is a query-time
  nearest-timestamp lookup. The *rigorous* synchronizer (with `sync_threshold` /
  `target_lidar_frame`) remains the separate nuScenes extraction microservice;
  we deliberately do not duplicate it in ingestion.
