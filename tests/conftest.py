"""Shared pytest fixtures.

The `bypass_auth` fixture overrides `require_current_user` to return a fake
active user on any FastAPI app it's applied to. Use it on any test that
constructs a FastAPI() instance and includes the protected routers.
"""
from __future__ import annotations

import pytest
from fastapi import FastAPI

from src.auth.dependencies import require_current_user
from src.auth.models import User


_FAKE_USER = User(id=1, username="test-user", is_active=True)


@pytest.fixture
def bypass_auth():
    """Return a callable that installs the auth bypass on a given FastAPI app.

    Usage:
        def test_something(bypass_auth):
            app = FastAPI()
            app.include_router(some_protected_router)
            bypass_auth(app)
            client = TestClient(app)
            ...
    """

    installed: list[FastAPI] = []

    def _install(app: FastAPI) -> FastAPI:
        app.dependency_overrides[require_current_user] = lambda: _FAKE_USER
        installed.append(app)
        return app

    yield _install

    for app in installed:
        app.dependency_overrides.pop(require_current_user, None)
