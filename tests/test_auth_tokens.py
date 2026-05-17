import time

import pytest
from jose import JWTError

from src.auth.tokens import (
    create_access_token,
    create_refresh_token,
    decode_access_token,
    decode_refresh_token,
)


def test_access_token_roundtrip(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "test-access-secret")
    monkeypatch.setenv("REFRESH_SECRET", "test-refresh-secret")
    token = create_access_token(username="alice", ttl_seconds=60)
    payload = decode_access_token(token)
    assert payload["sub"] == "alice"
    assert payload["type"] == "access"


def test_refresh_token_roundtrip(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "test-access-secret")
    monkeypatch.setenv("REFRESH_SECRET", "test-refresh-secret")
    token = create_refresh_token(username="alice", ttl_seconds=60)
    payload = decode_refresh_token(token)
    assert payload["sub"] == "alice"
    assert payload["type"] == "refresh"


def test_access_token_rejects_refresh_token(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "test-access-secret")
    monkeypatch.setenv("REFRESH_SECRET", "test-refresh-secret")
    refresh = create_refresh_token(username="alice", ttl_seconds=60)
    with pytest.raises(JWTError):
        decode_access_token(refresh)


def test_refresh_token_rejects_access_token(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "test-access-secret")
    monkeypatch.setenv("REFRESH_SECRET", "test-refresh-secret")
    access = create_access_token(username="alice", ttl_seconds=60)
    with pytest.raises(JWTError):
        decode_refresh_token(access)


def test_expired_access_token_raises(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "test-access-secret")
    monkeypatch.setenv("REFRESH_SECRET", "test-refresh-secret")
    token = create_access_token(username="alice", ttl_seconds=1)
    time.sleep(2)
    with pytest.raises(JWTError):
        decode_access_token(token)


def test_missing_secret_raises_on_create(monkeypatch):
    monkeypatch.delenv("JWT_SECRET", raising=False)
    with pytest.raises(RuntimeError, match="JWT_SECRET"):
        create_access_token(username="alice", ttl_seconds=60)
