from __future__ import annotations

from pathlib import Path
from typing import Any

from data_extraction_lib.artifacts import Metadata


NANOSECONDS_PER_SECOND = 1_000_000_000


class FocusFrameNotFound(ValueError):
    """Raised when focus_file_path does not identify a frame in metadata.json."""


def sample_tolerance_ns(sampling_fps: float) -> int:
    if sampling_fps <= 0:
        raise ValueError("sampling_fps must be positive.")
    return int((0.5 / sampling_fps) * NANOSECONDS_PER_SECOND)


def camera_list(metadata: Metadata) -> list[str]:
    if metadata.cameras:
        return [str(camera) for camera in metadata.cameras]

    seen: list[str] = []
    for frame in metadata.frames:
        topic = frame.get("topic")
        if topic is None:
            continue
        topic_str = str(topic)
        if topic_str not in seen:
            seen.append(topic_str)
    return seen


def _absolute_frame_path(artifact_dir: Path, frame: dict[str, Any]) -> Path:
    raw = Path(str(frame["file_path"])).expanduser()
    return raw.resolve() if raw.is_absolute() else (artifact_dir / raw).resolve()


def _frame_info(
    artifact_dir: Path,
    frame: dict[str, Any],
    sample_timestamp_ns: int,
    *,
    is_focus: bool = False,
) -> dict[str, Any]:
    info: dict[str, Any] = {
        "timestamp_ns": int(frame["timestamp_ns"]),
        "topic": str(frame["topic"]),
        "file_path": str(_absolute_frame_path(artifact_dir, frame)),
        "delta_ns": int(frame["timestamp_ns"]) - sample_timestamp_ns,
    }
    if is_focus:
        info["is_focus"] = True
    return info


def _frames_by_camera(metadata: Metadata) -> dict[str, list[dict[str, Any]]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for frame in metadata.frames:
        if "timestamp_ns" not in frame or "topic" not in frame or "file_path" not in frame:
            continue
        grouped.setdefault(str(frame["topic"]), []).append(frame)
    for frames in grouped.values():
        frames.sort(key=lambda item: int(item["timestamp_ns"]))
    return grouped


def _nearest_frame(
    frames: list[dict[str, Any]], timestamp_ns: int
) -> dict[str, Any] | None:
    if not frames:
        return None
    return min(frames, key=lambda item: abs(int(item["timestamp_ns"]) - timestamp_ns))


def _find_focus_frame(
    artifact_dir: Path,
    metadata: Metadata,
    focus_file_path: str,
) -> dict[str, Any]:
    raw_focus = Path(focus_file_path).expanduser()
    focus_abs = (
        raw_focus.resolve()
        if raw_focus.is_absolute()
        else (artifact_dir / raw_focus).resolve()
    )
    for frame in metadata.frames:
        if "file_path" not in frame:
            continue
        if _absolute_frame_path(artifact_dir, frame) == focus_abs:
            return frame
    raise FocusFrameNotFound(
        f"focus_file_path was not found in bag metadata: {focus_file_path}"
    )


def _build_sample(
    *,
    artifact_dir: Path,
    cameras: list[str],
    grouped: dict[str, list[dict[str, Any]]],
    timestamp_ns: int,
    tolerance_ns: int,
    anchor_camera: str | None,
    focus_frame: dict[str, Any] | None = None,
) -> dict[str, Any]:
    frames_by_camera: dict[str, dict[str, Any]] = {}
    focus_topic = str(focus_frame["topic"]) if focus_frame is not None else None

    for camera in cameras:
        if focus_frame is not None and camera == focus_topic:
            frames_by_camera[camera] = _frame_info(
                artifact_dir, focus_frame, timestamp_ns, is_focus=True
            )
            continue
        nearest = _nearest_frame(grouped.get(camera, []), timestamp_ns)
        if nearest is None:
            continue
        delta_ns = int(nearest["timestamp_ns"]) - timestamp_ns
        if abs(delta_ns) <= tolerance_ns:
            frames_by_camera[camera] = _frame_info(artifact_dir, nearest, timestamp_ns)

    return {
        "timestamp_ns": timestamp_ns,
        "anchor_frame": frames_by_camera.get(anchor_camera) if anchor_camera else None,
        "frames_by_camera": frames_by_camera,
    }


def build_samples_response(
    *,
    bag_path: Path,
    artifact_dir: Path,
    metadata: Metadata,
    start_ns: int,
    duration_sec: float,
    sampling_fps: float,
    focus_file_path: str | None = None,
) -> dict[str, Any]:
    cameras = camera_list(metadata)
    anchor_camera = cameras[0] if cameras else None
    tolerance_ns = sample_tolerance_ns(sampling_fps)
    grouped = _frames_by_camera(metadata)

    samples: list[dict[str, Any]] = []
    if focus_file_path:
        focus = _find_focus_frame(artifact_dir, metadata, focus_file_path)
        focus_timestamp_ns = int(focus["timestamp_ns"])
        samples.append(
            _build_sample(
                artifact_dir=artifact_dir,
                cameras=cameras,
                grouped=grouped,
                timestamp_ns=focus_timestamp_ns,
                tolerance_ns=tolerance_ns,
                anchor_camera=anchor_camera,
                focus_frame=focus,
            )
        )
    elif anchor_camera:
        end_ns = start_ns + int(duration_sec * NANOSECONDS_PER_SECOND)
        for anchor_frame in grouped.get(anchor_camera, []):
            timestamp_ns = int(anchor_frame["timestamp_ns"])
            if start_ns <= timestamp_ns <= end_ns:
                samples.append(
                    _build_sample(
                        artifact_dir=artifact_dir,
                        cameras=cameras,
                        grouped=grouped,
                        timestamp_ns=timestamp_ns,
                        tolerance_ns=tolerance_ns,
                        anchor_camera=anchor_camera,
                    )
                )

    return {
        "bag_path": str(bag_path),
        "cameras": cameras,
        "anchor_camera": anchor_camera,
        "sample_tolerance_ns": tolerance_ns,
        "samples": samples,
    }
