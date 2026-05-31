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

**Sample**:
The set of Frames from all Cameras captured at (approximately) the same instant
— a synchronized grouping used for visualization (show the full rig around a
hit) and, later, as the substrate for cross-camera Region search. Never a fused
embedding.
_Avoid_: keyframe, snapshot.

**Patch**:
A fixed-size square sub-region of a Frame (one cell of the model's patch grid)
carrying its own embedding. The atomic unit **Region search** indexes and
matches — parallel to how a whole Frame is the atomic unit of Global search.
_Avoid_: token (the model-internal name), cell, tile.

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

## Relationships

- A **Bag** carries several **Cameras**; each **Camera** yields many **Frames**
  (one per sampling tick).
- A **Sample** groups one **Frame** per **Camera** at a single instant.
- A **Frame** is divided into many **Patches**; **Region search** ranks a Frame
  by its single best-matching **Patch** against the query.
- **Global search** and **Region search** rank the same **Frames** by different
  evidence: whole-frame match vs. a single region match.
- A **Support image** drives **Global search** (whole image) or **Region search**
  (points on it); it may be an indexed **Frame** or an external upload.

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
