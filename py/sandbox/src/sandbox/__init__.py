"""A scratch pad for trying out arvo-core (py) as it currently exists on
disk -- not the last published PyPI release.

`arvo-core` is linked here as an editable install pointing at
`../arvo-core`, so this always sees whatever is currently in
`py/arvo-core/src/` -- no build or publish step needed; edit and re-run.

Run with `uv run sandbox`.
"""

from arvo_core.event import ArvoEvent, trace_context_from_span
from opentelemetry.trace import SpanContext, TraceFlags
from opentelemetry.trace.span import TraceState


def main() -> None:
    # -- OpenTelemetry trace context -----------------------------------
    # A real app derives this from an active span (`get_current_span()` /
    # `tracer.start_span(...)`). Here we build a SpanContext by hand --
    # valid 32-hex-digit trace ID, 16-hex-digit span ID -- so
    # trace_context_from_span can derive traceparent/tracestate from it the
    # same way it would from a real one. Tweak these values and re-run to
    # see how they show up on the event.
    span_context = SpanContext(
        trace_id=0x0AF7651916CD43DD8448EB211C80319C,
        span_id=0x00F067AA0BA902B7,
        is_remote=False,
        trace_flags=TraceFlags(TraceFlags.SAMPLED),
        trace_state=TraceState([("vendor", "value")]),  # set to None to see tracestate come out empty
    )
    ctx = trace_context_from_span(span_context)

    event = ArvoEvent(
        subject="order-42",
        source="order-service",
        type="order.created",
        data={"amount": 100},
        dataschema="#/contracts/order",
        traceparent=ctx.traceparent,
        tracestate=ctx.tracestate,
    )
    print("traceparent:", event.traceparent)
    print("tracestate:", event.tracestate)
    print("wire:", event.model_dump_json())
