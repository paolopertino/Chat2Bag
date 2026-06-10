# Bag-GPT

Multimodal retrieval over ROS2 bag recordings: sample camera frames, embed
them, and search them by text, by image, or by region.

## Language

### Recordings & frames

**Bag**:
A single ROS2 recording (`.mcap`) containing time-stamped sensor messages.

**Frame**:
One image from a *single* Camera sampled at a specific timestamp; the atomic
unit that gets embedded and searched. Always belongs to exactly one Camera.
_Avoid_: image (ambiguous with query images), thumbnail (that's the on-disk
artifact of a Frame).

**Camera**:
One camera on the vehicle, identified by its ROS2 topic. A Bag carries several.
_Avoid_: topic (that's the transport identifier for a Camera, not the concept).

**Camera layout**:
A user-defined spatial arrangement of Cameras for displaying a Sample. It
describes where each Camera's Frame appears in the viewer; it does not affect
indexing, ranking, or synchronization.
_Avoid_: camera label, topic order.

**Anchor Camera**:
The Camera whose Frame timestamps define the Sample timeline when browsing a
Bag. Other Cameras are joined to each Sample by nearest timestamp.
_Avoid_: master camera, camera stream.

**Sample**:
The synchronized grouping for one instant: at most one nearby Frame per Camera.
Cameras with no nearby Frame are absent from that Sample. Used for visualization
(show the full rig around a hit) and, later, as the substrate for cross-camera
Region search. Never a fused embedding.
_Avoid_: keyframe, snapshot.

**Patch**:
A fixed-size square sub-region of a Frame (one cell of the model's patch grid)
carrying its own embedding. The atomic unit **Region search** indexes and
matches — parallel to how a whole Frame is the atomic unit of Global search.
_Avoid_: token (the model-internal name), cell, tile.

### Geography

**Fix**:
A single GPS reading from the vehicle's satellite-navigation topic — a
(latitude, longitude) at one timestamp, sampled at its own (typically faster)
rate, independent of camera sampling. The raw geographic datum.
_Avoid_: GPS point, position (overloaded), coordinate.

**Track**:
The ordered sequence of Fixes for one Bag — the path the vehicle drove.
A display-and-derivation substrate, not a searchable unit itself.
_Avoid_: trajectory, route, path.

**Frame location**:
The (latitude, longitude) attributed to a Frame by joining the Track to the
Frame's timestamp (nearest Fix within a tolerance) — the same nearest-timestamp
resolution a Sample uses across cameras. A Frame whose timestamp has no nearby
valid Fix has *no* Frame location and is invisible to Map search.
_Avoid_: geotag, GPS coordinate of the frame.

### Search modes

**Support image**:
The reference image a user supplies to express a query — either an indexed Frame
or an arbitrary uploaded image — carrying the object of interest. The whole image
drives **Global search**; one or more points placed on it drive **Region search**.
_Avoid_: query image, reference image, probe.

**Global search**:
Ranking whole Frames by how well the *entire* frame matches a query (text or
image). The user's mental model is "find frames that look like X overall."
_Avoid_: CLS search, semantic search (too generic).

**Region search**:
Ranking Frames by whether they contain a specific entity the user specifies —
either by placing one or more points on a Support image (e.g. click a
traffic light) or by describing it in text — *even when that entity does not
dominate the frame*. The reason it must exist: Global search dissolves small
entities into the whole-frame embedding.
_Avoid_: dense search, patch search, entity search (pick one — "Region search"
is canonical).

**Area**:
A geographic shape the user draws on a map — a circle (a clicked point plus a
radius) or a polygon — expressing *where in the world* to look. The spatial
counterpart of a Support image: it carries no content, only extent.
**Region lives in image space (pixels inside a Frame); Area lives in world
space (coordinates on the map).** Keep them apart.
_Avoid_: region (means the patch concept), bounds (implies rectangle only),
geofence (implies a persistent enter/exit trigger).

**Map search**:
Constraining results to Frames whose **Frame location** falls inside an **Area**.
It is a *filter*, not a ranker: in/out is boolean, so on its own it browses
(every located Frame in the Area, time/distance ordered), and combined with a
text/image/Region query it narrows that query to the Area while the query still
ranks. The user's mental model is "look only here." Defined through a
full-screen map (click a point, or draw an Area).
_Avoid_: geo search, location search, area search (collides with Region).

## Relationships

- A **Bag** carries several **Cameras**; each **Camera** yields many **Frames**
  (one per sampling tick).
- A **Sample** is anchored by one **Anchor Camera** timestamp and groups at
  most one nearby **Frame** per **Camera**.
- A **Frame** is divided into many **Patches**; **Region search** ranks a Frame
  by its single best-matching **Patch** against the query.
- **Global search** and **Region search** rank the same **Frames** by different
  evidence: whole-frame match vs. a single region match.
- A **Support image** drives **Global search** (whole image) or **Region search**
  (points on it); it may be an indexed **Frame** or an external upload.
- A **Bag** carries one **Track** (its GPS path); the Track gives each **Frame**
  a **Frame location** by nearest-timestamp join (a Bag with no GPS topic has no
  Track, so none of its Frames are Map-searchable).
- An **Area** filters **Frames** by **Frame location**; **Map search** composes
  with **Global** or **Region search** (filter ∩ ranked query) or stands alone
  as a geographic browse.

## Flagged ambiguities

- "dense similarities among patches" was used to mean three different things:
  (a) within-frame patch-to-patch highlight, (b) within-frame text-to-patch
  highlight, (c) cross-frame region retrieval. **Resolved:** the objective is
  (c), now named **Region search**. (a) and (b) are within-frame visualizations
  that may fall out of the same features, but are not the goal.
- "synchronized and jointly processed" (multi-camera) implied a fused
  multi-view embedding. **Resolved:** Frames are embedded *independently* per
  Camera; "joint" means a synchronized **Sample** grouping for visualization,
  not a fused vector — fusing would re-dilute small entities the way Global
  search already does.
- **Recall paradox (OPEN):** Region search exists *because* Global search
  dissolves small entities — yet the cheapest Region-search design would reuse
  Global search for first-stage recall, inheriting that exact blind spot.
  Unresolved whether Region search needs its own region-level recall index.
