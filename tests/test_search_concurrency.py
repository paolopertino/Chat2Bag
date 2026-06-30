import asyncio
import threading
import time

import anyio
import httpx
import pytest
from fastapi import FastAPI
from httpx import ASGITransport

from src.api.dependencies import get_search_limiter, get_search_service
from src.api.search_routes import router as search_router


class _ConcurrencyStub:
    """Records the peak number of overlapping search calls."""

    def __init__(self):
        self._lock = threading.Lock()
        self.current = 0
        self.max_seen = 0

    def search(self, query, bag_paths, top_k, area=None):
        with self._lock:
            self.current += 1
            self.max_seen = max(self.max_seen, self.current)
        time.sleep(0.2)
        with self._lock:
            self.current -= 1
        return [{"timestamp_ns": 1, "similarity_score": 0.9}]


@pytest.mark.asyncio
async def test_search_offloads_and_caps_concurrency(bypass_auth):
    """Four concurrent /search requests overlap up to the limiter, not beyond.

    With the blocking stub running on the event loop (no offload), the requests
    would serialize and ``max_seen`` would be 1. Offloading to the threadpool under
    a ``CapacityLimiter(2)`` lets exactly two run at once.
    """
    stub = _ConcurrencyStub()
    limiter = anyio.CapacityLimiter(2)

    app = FastAPI()
    app.include_router(search_router)
    bypass_auth(app)
    app.dependency_overrides[get_search_service] = lambda: stub
    app.dependency_overrides[get_search_limiter] = lambda: limiter

    transport = ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://t") as client:

        async def one():
            return await client.post(
                "/api/search", json={"query": "x", "bag_paths": ["/b"], "top_k": 5}
            )

        resps = await asyncio.gather(*[one() for _ in range(4)])

    assert all(r.status_code == 200 for r in resps)
    assert stub.max_seen == 2
