import gc
import os
import logging

from contextlib import asynccontextmanager
from pathlib import Path

import torch
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from transformers import AutoProcessor, AutoModel

from src.api import (
    bags_router,
    chat_router,
    image_router,
    indexing_router,
    search_router,
)
from src.api.state import indexing_status
from src.core import get_app_config
from src.services.component_factory import BackendComponentFactory
from src.utils.logging_utils import setup_logging
from src.utils.paths import LOGGING_CONFIG_PATH

logger = logging.getLogger(__name__)


def _get_cors_origins() -> list[str]:
    configured_origins = os.environ.get("CORS_ORIGINS", "")
    if configured_origins.strip():
        return [
            origin.strip() for origin in configured_origins.split(",") if origin.strip()
        ]

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
    config = get_app_config()

    # Reset any bags left in "indexing" state from a previous crashed run.
    stuck_bags = [k for k, v in indexing_status.items() if v == "indexing"]
    for bag_path in stuck_bags:
        logger.warning(
            "Resetting stuck indexing status to 'error' for bag: %s", bag_path
        )
        indexing_status[bag_path] = "error"

    # Resolve compute device once at startup and share across all components.
    device = "cuda" if torch.cuda.is_available() else "cpu"
    logger.info("Using compute device: %s", device)

    model_checkpoints_path = config.models.model_storage
    if not os.path.exists(model_checkpoints_path):
        os.makedirs(model_checkpoints_path, exist_ok=True)

    try:
        embedding_model = AutoModel.from_pretrained(
            os.path.join(model_checkpoints_path, config.models.embedding_model)
        )
    except (OSError, ValueError):
        logger.info("Downloading embedding model for the first time...")
        embedding_model = AutoModel.from_pretrained(config.models.embedding_model)
        embedding_model.save_pretrained(
            os.path.join(model_checkpoints_path, config.models.embedding_model)
        )

    try:
        embedding_model_processor = AutoProcessor.from_pretrained(
            os.path.join(model_checkpoints_path, config.models.embedding_model)
        )
    except (OSError, ValueError):
        logger.info("Downloading embedding model processor for the first time...")
        embedding_model_processor = AutoProcessor.from_pretrained(
            config.models.embedding_model
        )
        embedding_model_processor.save_pretrained(
            os.path.join(model_checkpoints_path, config.models.embedding_model)
        )

    fastapi_app.state.app_config = config
    fastapi_app.state.embedding_model = embedding_model
    fastapi_app.state.embedding_model_processor = embedding_model_processor

    fastapi_app.state.component_factory = BackendComponentFactory(
        config=config,
        embedding_model=embedding_model,
        embedding_processor=embedding_model_processor,
        device=device,
    )

    fastapi_app.state.searcher_instance = (
        fastapi_app.state.component_factory.create_global_searcher()
    )

    yield

    logger.info("Server shutting down: clearing model resources")
    del fastapi_app.state.searcher_instance
    del fastapi_app.state.component_factory
    del fastapi_app.state.embedding_model_processor
    del fastapi_app.state.embedding_model
    del fastapi_app.state.app_config
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
app.include_router(indexing_router)
app.include_router(search_router)
app.include_router(chat_router)


static_dir = Path("static")
if static_dir.exists():
    app.mount("/", StaticFiles(directory=str(static_dir), html=True), name="static")
