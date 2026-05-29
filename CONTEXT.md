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

### Search modes

**Global search**:
Ranking whole Frames by how well the *entire* frame matches a query (text or
image). The user's mental model is "find frames that look like X overall."
_Avoid_: CLS search, semantic search (too generic).

**Region search**:
Ranking Frames by whether they contain a specific entity the user pointed at in
another Frame — e.g. click one traffic light, find frames containing a similar
traffic light — *even when that entity does not dominate the frame*. The reason
it must exist: Global search dissolves small entities into the whole-frame
embedding.
_Avoid_: dense search, patch search, entity search (pick one — "Region search"
is canonical).

## Relationships

- A **Bag** carries several **Cameras**; each **Camera** yields many **Frames**
  (one per sampling tick).
- A **Sample** groups one **Frame** per **Camera** at a single instant.
- **Global search** and **Region search** rank the same **Frames** by different
  evidence: whole-frame match vs. a single region match.

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
