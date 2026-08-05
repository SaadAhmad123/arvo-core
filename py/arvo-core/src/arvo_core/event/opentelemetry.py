"""OpenTelemetry span-derived trace context for `arvo_core.event.model.ArvoEvent`.

Requires the optional ``otel`` extra (``opentelemetry-api``). Nothing in
this module is imported by :mod:`arvo_core` itself — only calling
:func:`trace_context_from_span` requires ``opentelemetry-api`` to be
installed.
"""

from __future__ import annotations

from typing import NamedTuple

from opentelemetry.trace import Span, SpanContext


class ArvoEventTraceContext(NamedTuple):
    """W3C trace-context strings, ready to pass into `ArvoEvent`'s
    `traceparent`/`tracestate` fields."""

    traceparent: str
    tracestate: str | None


def trace_context_from_span(
    span_or_context: Span | SpanContext,
) -> ArvoEventTraceContext:
    """Derives W3C `traceparent`/`tracestate` strings from an OpenTelemetry
    `Span` or `SpanContext`, so you don't have to hand-format them.

    Example:
        ```python
        ctx = trace_context_from_span(span)
        event = ArvoEvent(
            ...,
            traceparent=ctx.traceparent,
            tracestate=ctx.tracestate,
        )
        ```
    """
    context = (
        span_or_context.get_span_context()
        if isinstance(span_or_context, Span)
        else span_or_context
    )
    traceparent = (
        f"00-{context.trace_id:032x}-{context.span_id:016x}-{context.trace_flags:02x}"
    )
    header = context.trace_state.to_header() if context.trace_state else ""
    return ArvoEventTraceContext(traceparent=traceparent, tracestate=header or None)
