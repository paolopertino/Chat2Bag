import copy
import uuid
from pathlib import Path
from typing import Any, Optional

import httpx

from src.core.extraction_config import ExtractionConfig
from src.core.storage import artifacts_for_bag


class ExtractionServiceError(Exception):
    pass


class ExtractionService:
    def __init__(self, config: ExtractionConfig) -> None:
        self._cfg = config
        self._base = config.service_url.rstrip("/") if config.service_url else ""
        self._timeout = config.request_timeout_sec

    # ------------------------------------------------------------------
    # Config / schema helpers
    # ------------------------------------------------------------------

    async def get_service_defaults(self) -> dict:
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            resp = await client.get(f"{self._base}/config/defaults")
            resp.raise_for_status()
            return resp.json()

    async def get_config_schema(self) -> dict:
        """Return the subset of defaults the UI should display + fixed_overrides preview."""
        try:
            defaults = await self.get_service_defaults()
        except Exception as exc:
            raise ExtractionServiceError(f"Cannot reach extraction service: {exc}") from exc

        editable = {k: defaults.get(k) for k in self._cfg.editable_fields if k in defaults}
        return {
            "enabled": True,
            "editable_fields": list(self._cfg.editable_fields),
            "defaults": editable,
            "fixed_overrides_preview": self._cfg.fixed_overrides,
        }

    # ------------------------------------------------------------------
    # Job management
    # ------------------------------------------------------------------

    def _rewrite_path(self, path: str) -> str:
        """Strip configured path prefix (e.g. /adehome) when the service runs in Docker."""
        prefix = self._cfg.path_strip_prefix
        if prefix and path.startswith(prefix):
            return path[len(prefix):]
        return path

    async def submit_extraction(
        self,
        bag_path: str,
        mode: str,
        user_config: dict,
        output_folder: Optional[str],
        timestamp_ns: Optional[int] = None,
        window_length_s: Optional[float] = None,
    ) -> str:
        """Merge config, compute output path, forward to microservice. Returns job_id."""
        defaults = await self.get_service_defaults()
        final_config = _merge_config(defaults, user_config, self._cfg.fixed_overrides)

        job_id = uuid.uuid4().hex
        resolved_output = output_folder or str(
            artifacts_for_bag(Path(bag_path)).dir
            / self._cfg.default_output_subdir
            / job_id
        )
        bag_path = self._rewrite_path(bag_path)

        payload: dict[str, Any] = {
            "bag_path": bag_path,
            "mode": mode,
            "config": final_config,
            "output_folder": resolved_output,
        }
        if timestamp_ns is not None:
            payload["timestamp_ns"] = timestamp_ns
        if window_length_s is not None:
            payload["window_length_s"] = window_length_s

        async with httpx.AsyncClient(timeout=self._timeout) as client:
            resp = await client.post(f"{self._base}/extract", json=payload)
            resp.raise_for_status()
            return resp.json()["job_id"]

    async def list_jobs(self) -> list[dict]:
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            resp = await client.get(f"{self._base}/jobs")
            resp.raise_for_status()
            return resp.json()

    async def get_job(self, job_id: str) -> dict:
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            resp = await client.get(f"{self._base}/jobs/{job_id}")
            resp.raise_for_status()
            return resp.json()

    async def cancel_job(self, job_id: str) -> dict:
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            resp = await client.delete(f"{self._base}/jobs/{job_id}")
            resp.raise_for_status()
            return resp.json()

    async def get_logs(self, job_id: str, tail: int = 500) -> list[str]:
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            resp = await client.get(
                f"{self._base}/jobs/{job_id}/logs", params={"tail": tail}
            )
            resp.raise_for_status()
            return resp.json()["lines"]

    async def health(self) -> dict:
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            resp = await client.get(f"{self._base}/health")
            resp.raise_for_status()
            return resp.json()


def _merge_config(base: dict, user_editable: dict, fixed_overrides: dict) -> dict:
    """Deep-merge: base ← user_editable ← fixed_overrides (fixed always wins)."""
    result = copy.deepcopy(base)
    _deep_update(result, user_editable)
    _deep_update(result, fixed_overrides)
    return result


def _deep_update(target: dict, source: dict) -> None:
    for k, v in source.items():
        if isinstance(v, dict) and isinstance(target.get(k), dict):
            _deep_update(target[k], v)
        else:
            target[k] = v
