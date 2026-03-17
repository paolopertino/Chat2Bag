import logging

from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, FastAPI, HTTPException, Request
from pydantic import BaseModel, Field

from src.api.state import indexing_status
from src.ingestion.bag_parser import BagParser
from src.ingestion.indexer import Indexer

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["indexing"])


class IndexRequest(BaseModel):
    bag_path: str = Field(..., min_length=1)


def run_indexing_pipeline(app: FastAPI, bag_path: str) -> None:
    """Runs heavy frame extraction and indexing work in the background."""
    resolved_bag_path = str(Path(bag_path).expanduser().resolve())
    indexing_status[resolved_bag_path] = "indexing"
    try:
        parser = BagParser(resolved_bag_path)
        parser.extract_frames()
        indexer = Indexer(
            resolved_bag_path,
            model=app.state.embedding_model,
            processor=app.state.embedding_model_processor,
        )
        indexer.build_index()
        indexing_status[resolved_bag_path] = "done"
        logger.info("Successfully indexed %s", resolved_bag_path)
    except (FileNotFoundError, OSError, RuntimeError, ValueError):
        indexing_status[resolved_bag_path] = "error"
        logger.exception("Indexing failed for %s", resolved_bag_path)


@router.post("/index")
async def index_bag(
    req: IndexRequest, background_tasks: BackgroundTasks, request: Request
):
    """Triggers extraction and indexing in the background."""
    bag_path = Path(req.bag_path).expanduser().resolve()
    if not bag_path.exists() or not bag_path.is_dir():
        raise HTTPException(status_code=404, detail="Bag path does not exist.")

    resolved_bag_path = str(bag_path)
    indexing_status[resolved_bag_path] = "indexing"
    background_tasks.add_task(run_indexing_pipeline, request.app, resolved_bag_path)
    return {"status": "Indexing started in the background", "bag": resolved_bag_path}
