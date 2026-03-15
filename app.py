import gc
import os
import logging
import yaml

from contextlib import asynccontextmanager
from pathlib import Path
from typing import List

from fastapi import FastAPI, BackgroundTasks, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from transformers import AutoProcessor, AutoModel

from src.api.bags import router as bags_router
from src.api.image import router as image_router
from src.api.state import indexing_status
from src.ingestion.bag_parser import BagParser
from src.retriever.global_search import GlobalSearcher
from src.ingestion.indexer import Indexer
from src.retriever.video_chat import VideoChat
from src.utils.logging_utils import setup_logging
from src.utils.paths import LOGGING_CONFIG_PATH, SETTINGS_PATH

ml_models = {}
logger = logging.getLogger(__name__)


def _get_cors_origins() -> list[str]:
    configured_origins = os.environ.get("CORS_ORIGINS", "")
    if configured_origins.strip():
        return [origin.strip() for origin in configured_origins.split(",") if origin.strip()]

    return [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
    ]


@asynccontextmanager
async def lifespan(fastapi_app: FastAPI):
    setup_logging(str(LOGGING_CONFIG_PATH))
    logger.info("Server starting up")
    with SETTINGS_PATH.open("r", encoding="utf-8") as f:
        config = yaml.safe_load(f)
    
    model_checkpoints_path = config['models']['model_storage']
    if not os.path.exists(model_checkpoints_path):
        os.makedirs(model_checkpoints_path, exist_ok=True)

    try:
        ml_models["embedding_model"] = AutoModel.from_pretrained(os.path.join(model_checkpoints_path, config["models"]["embedding_model"]))
    except Exception as _:
        print("Downloading embedding model for the first time...")
        ml_models["embedding_model"] = AutoModel.from_pretrained(config["models"]["embedding_model"])
        ml_models["embedding_model"].save_pretrained(os.path.join(model_checkpoints_path, config["models"]["embedding_model"]))
    
    try:
        ml_models["embedding_model_processor"] = AutoProcessor.from_pretrained(os.path.join(model_checkpoints_path, config["models"]["embedding_model"]))
    except Exception as _:
        print("Downloading embedding model processor for the first time...")
        ml_models["embedding_model_processor"] = AutoProcessor.from_pretrained(config["models"]["embedding_model"])
        ml_models["embedding_model_processor"].save_pretrained(os.path.join(model_checkpoints_path, config["models"]["embedding_model"]))

    fastapi_app.state.searcher_instance = GlobalSearcher(
        model=ml_models["embedding_model"],
        processor=ml_models["embedding_model_processor"]
    )

    yield

    logger.info("Server shutting down: clearing model resources")
    del fastapi_app.state.searcher_instance
    gc.collect()


app = FastAPI(
    title="ROS2 Bag Chat API",
    description="Multimodal RAG Backend for AIDA Data",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_get_cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(bags_router)
app.include_router(image_router)


class IndexRequest(BaseModel):
    bag_path: str = Field(..., min_length=1)


class SearchRequest(BaseModel):
    query: str = Field(..., min_length=1)
    bag_paths: List[str]
    top_k: int = Field(default=5, ge=1, le=100)


class ChatRequest(BaseModel):
    bag_path: str = Field(..., min_length=1)
    start_ns: int = Field(..., ge=0)
    duration: int = Field(default=10, ge=1, le=300)
    query: str = Field(..., min_length=1)


def run_indexing_pipeline(bag_path: str):
    """Runs the heavy parsing and embedding offline."""
    resolved_bag_path = str(Path(bag_path).expanduser().resolve())
    indexing_status[resolved_bag_path] = "indexing"
    try:
        parser = BagParser(resolved_bag_path)
        parser.extract_frames()
        indexer = Indexer(
            resolved_bag_path,
            model=ml_models["embedding_model"],
            processor=ml_models["embedding_model_processor"],
        )
        indexer.build_index()
        indexing_status[resolved_bag_path] = "done"
        logger.info("Successfully indexed %s", resolved_bag_path)
    except (FileNotFoundError, OSError, RuntimeError, ValueError):
        indexing_status[resolved_bag_path] = "error"
        logger.exception("Indexing failed for %s", resolved_bag_path)


@app.post("/api/index")
async def index_bag(req: IndexRequest, background_tasks: BackgroundTasks):
    """Triggers extraction and indexing in the background."""
    bag_path = Path(req.bag_path).expanduser().resolve()
    if not bag_path.exists() or not bag_path.is_dir():
        raise HTTPException(status_code=404, detail="Bag path does not exist.")

    resolved_bag_path = str(bag_path)
    indexing_status[resolved_bag_path] = "indexing"
    background_tasks.add_task(run_indexing_pipeline, resolved_bag_path)
    return {"status": "Indexing started in the background", "bag": resolved_bag_path}


@app.post("/api/search")
async def search_bags(req: SearchRequest, request: Request):
    """Federated search across multiple bags using the shared Searcher object."""
    if not req.bag_paths:
        raise HTTPException(
            status_code=400, detail="Must provide at least one bag path."
        )

    results = request.app.state.searcher_instance.search(
        query=req.query, bag_paths=req.bag_paths, top_k=req.top_k
    )

    return {"query": req.query, "results": results}


@app.post("/api/chat")
async def chat_clip(req: ChatRequest):
    """Chat with a specific sequence."""
    bag_path = Path(req.bag_path).expanduser().resolve()
    if not bag_path.exists() or not bag_path.is_dir():
        raise HTTPException(status_code=404, detail="Bag path does not exist.")

    try:
        chat_engine = VideoChat(str(bag_path))
        response_text = chat_engine.chat_with_clip(
            start_timestamp_ns=req.start_ns, duration_sec=req.duration, query=req.query
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


static_dir = Path("static")
if static_dir.exists():
    app.mount("/", StaticFiles(directory=str(static_dir), html=True), name="static")