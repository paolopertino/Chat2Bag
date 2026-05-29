import re
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse

from src.core.settings import get_settings

router = APIRouter(prefix="/api", tags=["images"])

_SETTINGS = get_settings()

_ARTIFACT_DIR_NAME = _SETTINGS["storage"]["artifact_dir"]

# Frames live at <artifact_dir>/thumbnails/<camera_slug>/frame_<ts>.jpg (per-camera,
# schema v3) or the legacy flat <artifact_dir>/thumbnails/frame_<ts>.jpg layout. The
# optional single camera segment ([^/]+/) permits exactly one sub-level — no traversal.
_FRAME_PATTERN = re.compile(
    r"^.*/" + re.escape(_ARTIFACT_DIR_NAME) + r"/thumbnails/(?:[^/]+/)?frame_\d+\.jpg$"
)


@router.get("/image")
async def get_image(
    path: str = Query(..., description="Absolute path to extracted frame image")
):
    image_path = Path(path).expanduser().resolve()
    image_path_str = str(image_path)

    if not image_path.is_absolute():
        raise HTTPException(status_code=400, detail="Path must be absolute")

    # The anchored pattern (matched after .resolve() collapses any `..`) is the
    # traversal guard: it requires the file to sit directly under an
    # <artifact_dir>/thumbnails[/<camera>] directory with a frame_<ts>.jpg name.
    if not _FRAME_PATTERN.match(image_path_str):
        raise HTTPException(
            status_code=400, detail="Path is not a valid extracted frame"
        )

    if not image_path.exists() or not image_path.is_file():
        raise HTTPException(status_code=404, detail="Image not found")

    return FileResponse(
        path=image_path_str,
        media_type="image/jpeg",
        headers={"Cache-Control": "public, max-age=86400"},
    )
