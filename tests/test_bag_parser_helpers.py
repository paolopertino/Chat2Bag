import numpy as np

from src.ingestion.bag_parser import camera_slug, resize_long_side


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
