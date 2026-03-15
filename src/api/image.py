import re
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse

router = APIRouter(prefix="/api", tags=["images"])

_FRAME_PATTERN = re.compile(r"^.*/\.bag_chat/thumbnails/frame_\d+\.jpg$")


@router.get("/image")
async def get_image(path: str = Query(..., description="Absolute path to extracted frame image")):
    image_path = Path(path).expanduser().resolve()
    image_path_str = str(image_path)

    if not image_path.is_absolute():
        raise HTTPException(status_code=400, detail="Path must be absolute")

    if not _FRAME_PATTERN.match(image_path_str):
        raise HTTPException(status_code=400, detail="Path is not a valid extracted frame")

    if not image_path.exists() or not image_path.is_file():
        raise HTTPException(status_code=404, detail="Image not found")

    return FileResponse(path=image_path_str, media_type="image/jpeg")
