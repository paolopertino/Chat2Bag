import numpy as np

from rosbags.rosbag2 import ReaderError

from src.ingestion.bag_parser import camera_slug, describe_reader_error, resize_long_side


def test_describe_reader_error_flags_missing_end_magic_as_incomplete():
    msg = describe_reader_error(ReaderError("File end magic is invalid."), "2026-05-19_17-25_normal")
    assert "2026-05-19_17-25_normal" in msg
    # actionable, human-readable explanation rather than the raw rosbags text
    assert "incomplete or corrupt" in msg.lower()
    assert "mcap recover" in msg.lower()


def test_describe_reader_error_flags_missing_start_magic_as_corrupt():
    msg = describe_reader_error(ReaderError("File magic is invalid."), "broken_bag")
    assert "broken_bag" in msg
    assert "incomplete or corrupt" in msg.lower()


def test_describe_reader_error_passes_through_other_reader_errors():
    msg = describe_reader_error(ReaderError("Profile is not ros2."), "weird_bag")
    assert "weird_bag" in msg
    assert "Profile is not ros2." in msg
    # a non-magic failure must not be mislabeled as an unfinalized recording
    assert "incomplete or corrupt" not in msg.lower()


def test_resize_downscales_to_long_side_preserving_aspect():
    img = np.zeros((600, 1200, 3), dtype=np.uint8)  # H=600, W=1200
    out = resize_long_side(img, long_side=840)
    assert max(out.shape[:2]) == 840           # long edge clamped
    assert out.shape[1] == 840 and out.shape[0] == 420  # aspect preserved (2:1)


def test_resize_does_not_upscale_smaller_images():
    img = np.zeros((100, 200, 3), dtype=np.uint8)
    out = resize_long_side(img, long_side=840)
    assert out.shape[:2] == (100, 200)          # unchanged


def test_camera_slug_is_filesystem_safe_and_stable():
    assert camera_slug("/lucid/cam_front/image_rect/compressed") == "lucid_cam_front_image_rect_compressed"
    assert camera_slug("/cam/rear") == "cam_rear"
    assert "/" not in camera_slug("/a/b/c")
