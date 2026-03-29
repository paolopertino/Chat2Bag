from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from src.api.dependencies import get_chat_service
from src.services.chat_service import ChatService

router = APIRouter(prefix="/api", tags=["chat"])


class ChatRequest(BaseModel):
    bag_path: str = Field(..., min_length=1)
    start_ns: int = Field(..., ge=0)
    duration: int = Field(default=10, ge=1, le=300)
    query: str = Field(..., min_length=1)


@router.post("/chat")
async def chat_clip(
    req: ChatRequest,
    chat_service: Annotated[ChatService, Depends(get_chat_service)],
):
    """Chat with a specific sequence."""
    try:
        response_text = chat_service.chat_with_clip(
            bag_path=req.bag_path,
            start_ns=req.start_ns,
            duration=req.duration,
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
