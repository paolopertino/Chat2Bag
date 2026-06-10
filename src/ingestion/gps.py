"""GPS Fix reading + nearest-Fix Frame-location join (Map search).

Kept self-contained so a future lightweight "locate-only" backfill pass can
re-read the GPS topic without re-extracting thumbnails or re-embedding.
"""
import bisect
import math
from dataclasses import dataclass


@dataclass(frozen=True)
class Fix:
    """One valid GPS fix: bag timestamp (ns) + WGS84 lat/lon."""

    timestamp_ns: int
    lat: float
    lon: float


def fix_from_navsatfix(msg, timestamp_ns: int) -> "Fix | None":
    """Build a Fix from a deserialized sensor_msgs/msg/NavSatFix, or None if invalid.

    Validity (spec §2.1, non-negotiable): keep only if status.status >= 0
    (drops NO_FIX = -1) AND lat/lon are finite (NavSatFix carries NaN when unfixed).
    """
    if int(msg.status.status) < 0:
        return None
    lat = float(msg.latitude)
    lon = float(msg.longitude)
    if not (math.isfinite(lat) and math.isfinite(lon)):
        return None
    return Fix(timestamp_ns=int(timestamp_ns), lat=lat, lon=lon)


def locate_frames(frames: list[dict], fixes: list["Fix"], max_gap_ns: int) -> int:
    """Attach lat/lon to each frame from its nearest Fix within max_gap_ns.

    Mutates `frames` in place (adds "lat"/"lon" when a Fix is within tolerance;
    leaves them absent otherwise — no interpolation). Returns the located count.
    """
    if not fixes:
        return 0
    ordered = sorted(fixes, key=lambda f: f.timestamp_ns)
    fix_ts = [f.timestamp_ns for f in ordered]
    located = 0
    for frame in frames:
        t = int(frame["timestamp_ns"])
        i = bisect.bisect_left(fix_ts, t)
        best = None
        for cand in (i - 1, i):
            if 0 <= cand < len(ordered):
                gap = abs(ordered[cand].timestamp_ns - t)
                if gap <= max_gap_ns and (best is None or gap < best[0]):
                    best = (gap, ordered[cand])
        if best is not None:
            frame["lat"] = best[1].lat
            frame["lon"] = best[1].lon
            located += 1
    return located


def read_fixes(reader, gps_topic: str, typestore) -> list["Fix"]:
    """Read all valid Fixes from a bag's GPS topic in a single pass.

    Used by a future locate-only backfill; extraction reuses `fix_from_navsatfix`
    inline in its existing message loop instead of calling this.
    """
    gps_conns = [c for c in reader.connections if c.topic == gps_topic]
    if not gps_conns:
        return []
    fixes: list[Fix] = []
    for connection, timestamp_ns, rawdata in reader.messages(connections=gps_conns):
        msg = typestore.deserialize_cdr(rawdata, connection.msgtype)
        fix = fix_from_navsatfix(msg, timestamp_ns)
        if fix is not None:
            fixes.append(fix)
    return fixes
