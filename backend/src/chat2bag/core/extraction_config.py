from dataclasses import dataclass, field
from typing import Optional


@dataclass(frozen=True)
class ExtractionConfig:
    enabled: bool
    service_url: Optional[str]
    request_timeout_sec: float
    default_output_subdir: str
    editable_fields: tuple[str, ...]
    fixed_overrides: dict
    path_strip_prefix: Optional[str]

    @staticmethod
    def disabled() -> "ExtractionConfig":
        return ExtractionConfig(
            enabled=False,
            service_url=None,
            request_timeout_sec=10.0,
            default_output_subdir="nuscenes_extractions",
            editable_fields=(),
            fixed_overrides={},
            path_strip_prefix=None,
        )
