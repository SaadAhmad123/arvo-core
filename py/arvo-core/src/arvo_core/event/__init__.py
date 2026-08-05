from typing import TYPE_CHECKING

from arvo_core.event.errors import ArvoEventValidationError
from arvo_core.event.model import ArvoEvent

if TYPE_CHECKING:
    from arvo_core.event.opentelemetry import (
        ArvoEventTraceContext,
        trace_context_from_span,
    )

__all__ = [
    "ArvoEvent",
    "ArvoEventTraceContext",
    "ArvoEventValidationError",
    "trace_context_from_span",
]


def __getattr__(name: str) -> object:
    # Lazily import the optional OpenTelemetry integration, so importing
    # `arvo_core.event` itself never requires `opentelemetry-api` to be
    # installed -- only actually using `trace_context_from_span` does.
    if name in ("trace_context_from_span", "ArvoEventTraceContext"):
        from arvo_core.event import opentelemetry

        return getattr(opentelemetry, name)
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
