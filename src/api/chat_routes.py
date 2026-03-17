from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from src.retriever.video_chat import VideoChat

router = APIRouter(prefix="/api", tags=["chat"])


class ChatRequest(BaseModel):
    bag_path: str = Field(..., min_length=1)
    start_ns: int = Field(..., ge=0)
    duration: int = Field(default=10, ge=1, le=300)
    query: str = Field(..., min_length=1)


@router.post("/chat")
async def chat_clip(req: ChatRequest):
    """Chat with a specific sequence."""
    bag_path = Path(req.bag_path).expanduser().resolve()
    if not bag_path.exists() or not bag_path.is_dir():
        raise HTTPException(status_code=404, detail="Bag path does not exist.")

    try:
        chat_engine = VideoChat(str(bag_path))
        response_text = chat_engine.chat_with_clip(
            start_timestamp_ns=req.start_ns,
            duration_sec=req.duration,
            query=req.query,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    if not response_text:
        raise HTTPException(
            status_code=404, detail="No frames found in that time window."
        )

    return {"response": response_text}
