import gc
import yaml

from contextlib import asynccontextmanager
from pathlib import Path
from typing import List

from fastapi import FastAPI, BackgroundTasks, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from transformers import AutoProcessor, AutoModel

from src.api.bags import router as bags_router
from src.api.image import router as image_router
from src.api.state import indexing_status
from src.ingestion.bag_parser import BagParser
from src.retriever.global_search import GlobalSearcher
from src.ingestion.indexer import Indexer
from src.retriever.video_chat import VideoChat

ml_models = {}


@asynccontextmanager
async def lifespan(fastapi_app: FastAPI):
    print("Server starting up...")
    with open("config/settings.yaml", "r", encoding="utf-8") as f:
        config = yaml.safe_load(f)

    ml_models["embedding_model"] = AutoModel.from_pretrained(config["models"]["embedding_model"])
    ml_models["embedding_model_processor"] = AutoProcessor.from_pretrained(config["models"]["embedding_model"])

    fastapi_app.state.searcher_instance = GlobalSearcher(
        model=ml_models["embedding_model"],
        processor=ml_models["embedding_model_processor"]
    )

    yield

    print("Server shutting down: Clearing GPU memory...")
    del fastapi_app.state.searcher_instance
    gc.collect()


app = FastAPI(
    title="ROS2 Bag Chat API",
    description="Multimodal RAG Backend for AIDA Data",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(bags_router)
app.include_router(image_router)


class IndexRequest(BaseModel):
    bag_path: str


class SearchRequest(BaseModel):
    query: str
    bag_paths: List[str]
    top_k: int = 5


class ChatRequest(BaseModel):
    bag_path: str
    start_ns: int
    duration: int = 10
    query: str


def run_indexing_pipeline(bag_path: str):
    """Runs the heavy parsing and embedding offline."""
    indexing_status[bag_path] = "indexing"
    try:
        parser = BagParser(bag_path)
        parser.extract_frames()
        indexer = Indexer(bag_path, model=ml_models["embedding_model"], processor=ml_models["embedding_model_processor"])
        indexer.build_index()
        indexing_status[bag_path] = "done"
        print(f"Successfully indexed: {bag_path}")
    except Exception as e:
        indexing_status[bag_path] = "error"
        print(f"Indexing failed for {bag_path}: {e}")


@app.post("/api/index")
async def index_bag(req: IndexRequest, background_tasks: BackgroundTasks):
    """Triggers extraction and indexing in the background."""
    if not Path(req.bag_path).exists():
        raise HTTPException(status_code=404, detail="Bag path does not exist.")

    indexing_status[req.bag_path] = "indexing"
    background_tasks.add_task(run_indexing_pipeline, req.bag_path)
    return {"status": "Indexing started in the background", "bag": req.bag_path}


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
    if not Path(req.bag_path).exists():
        raise HTTPException(status_code=404, detail="Bag path does not exist.")

    chat_engine = VideoChat(req.bag_path)
    response_text = chat_engine.chat_with_clip(
        start_timestamp_ns=req.start_ns, duration_sec=req.duration, query=req.query
    )

    if not response_text:
        raise HTTPException(
            status_code=404, detail="No frames found in that time window."
        )

    return {"response": response_text}


static_dir = Path("static")
if static_dir.exists():
    app.mount("/", StaticFiles(directory=str(static_dir), html=True), name="static")