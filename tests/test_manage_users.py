import asyncio
import os
import subprocess
import sys


def _run_cli(args: list[str], env: dict, stdin: str = "") -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, "backend/scripts/manage_users.py", *args],
        input=stdin,
        capture_output=True,
        text=True,
        env=env,
    )


def test_add_user_then_list(tmp_path):
    env = {**os.environ, "AUTH_DB_PATH": str(tmp_path / "users.db"), "PYTHONPATH": ""}
    add = _run_cli(["add-user", "alice"], env=env, stdin="pw\npw\n")
    assert add.returncode == 0, add.stderr

    listed = _run_cli(["list-users"], env=env)
    assert listed.returncode == 0
    assert "alice" in listed.stdout
    assert "active" in listed.stdout.lower()


def test_add_user_duplicate_errors(tmp_path):
    env = {**os.environ, "AUTH_DB_PATH": str(tmp_path / "users.db"), "PYTHONPATH": ""}
    _run_cli(["add-user", "alice"], env=env, stdin="pw\npw\n")
    result = _run_cli(["add-user", "alice"], env=env, stdin="pw\npw\n")
    assert result.returncode != 0
    assert "already exists" in (result.stderr + result.stdout).lower()


def test_password_mismatch_errors(tmp_path):
    env = {**os.environ, "AUTH_DB_PATH": str(tmp_path / "users.db"), "PYTHONPATH": ""}
    result = _run_cli(["add-user", "alice"], env=env, stdin="one\ntwo\n")
    assert result.returncode != 0


def test_delete_user_deactivates(tmp_path):
    env = {**os.environ, "AUTH_DB_PATH": str(tmp_path / "users.db"), "PYTHONPATH": ""}
    _run_cli(["add-user", "alice"], env=env, stdin="pw\npw\n")
    result = _run_cli(["delete-user", "alice"], env=env)
    assert result.returncode == 0
    listed = _run_cli(["list-users"], env=env)
    assert "inactive" in listed.stdout.lower()


def test_reset_password_changes_hash(tmp_path, monkeypatch):
    monkeypatch.setenv("AUTH_DB_PATH", str(tmp_path / "users.db"))
    env = {**os.environ, "AUTH_DB_PATH": str(tmp_path / "users.db"), "PYTHONPATH": ""}

    from chat2bag.auth.db import _fetch_hashed_password, ensure_db_initialized

    asyncio.run(ensure_db_initialized())
    _run_cli(["add-user", "alice"], env=env, stdin="old\nold\n")
    old_hash = asyncio.run(_fetch_hashed_password("alice"))

    result = _run_cli(["reset-password", "alice"], env=env, stdin="new\nnew\n")
    assert result.returncode == 0, result.stderr

    new_hash = asyncio.run(_fetch_hashed_password("alice"))
    assert new_hash != old_hash, "hash should have changed after password reset"
