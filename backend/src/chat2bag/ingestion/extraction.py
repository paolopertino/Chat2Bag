"""App-side extraction: wire the library's ros2 pipeline and project its result.

This is the Chat2Bag bridge between the library's policy-free extraction
(`data_extraction_lib.ros2`) and the webapp's persisted artifact format
(`data_extraction_lib.artifacts.Metadata`). The library returns a
``LocatedFramesResult`` of plain facts; this module owns the Chat2Bag projection
(camera selection, lat/lon flattening, GPS-stamp gating) and the storage policy.
"""

import logging
from pathlib import Path

from data_extraction_lib.artifacts import GpsStamp, Metadata
from data_extraction_lib.ros2 import (
    BagFrameExtractor,
    BagReader,
    CollectSink,
    DecimationPolicy,
    Frame,
    FrameRecord,
    ImageFrameConverter,
    ImageSink,
    LocatedFrame,
    LocatedFramesResult,
    NavSatFixConverter,
    NearestJoinAssembly,
    PerCameraLayout,
    TimestampedCoordinate,
)

from chat2bag.core.app_config import AppConfig, get_app_config
from chat2bag.core.storage import artifacts_for_bag

logger = logging.getLogger(__name__)

_IMAGE_MSGTYPE = "sensor_msgs/msg/CompressedImage"
_NAVSATFIX_MSGTYPE = "sensor_msgs/msg/NavSatFix"


def build_extractor(bag_path: str, config: AppConfig, artifacts) -> BagFrameExtractor:
    """Wire a :class:`BagFrameExtractor` from app config + artifact layout.

    GPS converter, sink, and topic are wired only when ``config.ingestion.gps_topic``
    is set, so a ``None`` topic never reaches the reader.

    :param bag_path: Path to the bag directory.
    :param config: The app configuration.
    :param artifacts: The bag's :class:`BagArtifacts` layout.
    :returns: A configured single-pass extractor.
    """

    camera_topics = list(config.ingestion.camera_topics)
    gps_topic = config.ingestion.gps_topic

    converters = {_IMAGE_MSGTYPE: ImageFrameConverter(long_side=config.ingestion.long_side)}
    sinks = {Frame: ImageSink(base_dir=artifacts.dir, layout=PerCameraLayout())}
    topics = list(camera_topics)
    if gps_topic:
        converters[_NAVSATFIX_MSGTYPE] = NavSatFixConverter()
        sinks[TimestampedCoordinate] = CollectSink()
        topics.append(gps_topic)

    max_gap_ns = int(config.ingestion.gps_max_gap_sec * 1e9)
    return BagFrameExtractor(
        reader=BagReader(Path(bag_path)),
        selection=DecimationPolicy(rates={t: config.ingestion.sampling_fps for t in camera_topics}),
        converters=converters,
        assembly=NearestJoinAssembly(
            leader=FrameRecord,
            attach=[TimestampedCoordinate],
            key=lambda record: record.timestamp_ns,
            max_gap_ns=max_gap_ns,
            combine=lambda frame, matches: LocatedFrame(
                frame=frame, coordinate=matches[TimestampedCoordinate]
            ),
        ),
        sinks=sinks,
        topics=topics,
    )


def result_to_metadata(result: LocatedFramesResult, bag_name: str, config: AppConfig) -> Metadata:
    """Project a :class:`LocatedFramesResult` into Chat2Bag's :class:`Metadata`.

    :param result: The library extraction facts.
    :param bag_name: The bag's name (stored in metadata).
    :param config: The app configuration (for camera topics, GPS topic/gap).
    :returns: A populated :class:`Metadata` (not yet saved).
    :raises ValueError: If none of the configured camera topics are present in the bag.
    """

    camera_topics = set(config.ingestion.camera_topics)
    cameras = sorted(t for t in result.present_topics if t in camera_topics)
    if not cameras:
        raise ValueError(
            f"None of the configured camera topics {sorted(camera_topics)} found in {bag_name}"
        )

    frames: list[dict] = []
    for located in result.located_frames:
        frame = {
            "timestamp_ns": located.frame.timestamp_ns,
            "topic": located.frame.topic,
            "file_path": located.frame.file_path,
        }
        if located.coordinate is not None:
            frame["lat"] = located.coordinate.lat
            frame["lon"] = located.coordinate.lon
        frames.append(frame)

    gps_topic = config.ingestion.gps_topic
    gps_stamp = None
    if gps_topic and gps_topic in result.present_topics:
        located_count = sum(1 for lf in result.located_frames if lf.coordinate is not None)
        gps_stamp = GpsStamp(
            topic=gps_topic,
            max_gap_sec=config.ingestion.gps_max_gap_sec,
            fix_count=len(result.coordinates),
            located_frame_count=located_count,
            frame_count=len(result.located_frames),
        )

    return Metadata(bag_name=bag_name, cameras=cameras, frames=frames, gps=gps_stamp)


class BagExtractor:
    """Run extraction for one bag and persist Chat2Bag's ``metadata.json``.

    :param bag_path: Path to the bag directory.
    :param config: The app configuration; falls back to :func:`get_app_config`.
    """

    def __init__(self, bag_path: str, config: AppConfig | None = None):
        self._bag_path = Path(bag_path)
        self._config = config or get_app_config()
        self._artifacts = artifacts_for_bag(self._bag_path)
        self._artifacts.thumbnails_dir.mkdir(parents=True, exist_ok=True)

    def extract(self) -> Path:
        """Extract frames + GPS, save metadata, and return the metadata path.

        :returns: The saved ``metadata.json`` path.
        :raises ValueError: If no configured camera topic is present in the bag.
        :raises BagReadError: If the bag cannot be read.
        """

        extractor = build_extractor(str(self._bag_path), self._config, self._artifacts)
        result = extractor.run()
        meta = result_to_metadata(result, bag_name=self._bag_path.name, config=self._config)
        meta.save(self._artifacts)
        logger.info("Extraction complete: %d frames across %d cameras", len(meta.frames), len(meta.cameras))
        return self._artifacts.metadata_path
