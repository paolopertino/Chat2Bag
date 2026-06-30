import gc
import os
import logging

from contextlib import asynccontextmanager
from pathlib import Path

import anyio
import torch
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from src.api import (
    auth_router,
    bags_router,
    datasets_router,
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

    # Fail fast if auth secrets are missing.
    for required_env in ("JWT_SECRET", "REFRESH_SECRET"):
        if not os.environ.get(required_env):
            raise RuntimeError(f"{required_env} environment variable is required")

    # Ensure user DB exists (file + schema).
    from src.auth.db import ensure_db_initialized
    await ensure_db_initialized()

    config = get_app_config()

    # Reset any bags left in "indexing" state from a previous crashed run.
    stuck_bags = [k for k, v in indexing_status.items() if v == "indexing"]
    for bag_path in stuck_bags:
        logger.warning(
            "Resetting stuck indexing status to 'error' for bag: %s", bag_path
        )
        indexing_status[bag_path] = "error"

    # Resolve compute device once at startup and share across all components.
    from data_extraction_lib.embedding import create_embedder

    from src.core.embedding_settings import embedding_settings_from_config
    from src.core.normalizing_embedder import NormalizingEmbedder

    device = "cuda" if torch.cuda.is_available() else "cpu"
    logger.info("Using compute device: %s", device)

    model_checkpoints_path = config.models.model_storage
    if not os.path.exists(model_checkpoints_path):
        os.makedirs(model_checkpoints_path, exist_ok=True)

    embedder = NormalizingEmbedder(
        create_embedder(embedding_settings_from_config(config), device=device)
    )
    logger.info("Active embedder: %s (dim=%d)", embedder.name, embedder.embedding_dim)

    fastapi_app.state.app_config = config
    fastapi_app.state.embedder = embedder

    fastapi_app.state.component_factory = BackendComponentFactory(
        config=config,
        embedder=embedder,
    )

    fastapi_app.state.global_search_instance = (
        fastapi_app.state.component_factory.create_global_search()
    )

    fastapi_app.state.dense_search_instance = (
        fastapi_app.state.component_factory.create_dense_search()
    )

    # Bound concurrent embedding/GPU-bound search work; the rest queue.
    fastapi_app.state.search_limiter = anyio.CapacityLimiter(
        config.search.max_concurrent_searches
    )

    if config.extraction.enabled:
        logger.info("Dataset extraction enabled, service URL: %s", config.extraction.service_url)
    else:
        logger.info("Dataset extraction disabled (no service_url configured)")

    yield

    logger.info("Server shutting down: clearing model resources")
    fastapi_app.state.embedder.offload()
    del fastapi_app.state.global_search_instance
    if getattr(fastapi_app.state, "dense_search_instance", None) is not None:
        del fastapi_app.state.dense_search_instance
    del fastapi_app.state.search_limiter
    del fastapi_app.state.component_factory
    del fastapi_app.state.embedder
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

app.include_router(auth_router)
app.include_router(bags_router)
app.include_router(image_router)
app.include_router(indexing_router)
app.include_router(search_router)
app.include_router(datasets_router)


static_dir = Path("static")
if static_dir.exists():
    app.mount("/", StaticFiles(directory=str(static_dir), html=True), name="static")
