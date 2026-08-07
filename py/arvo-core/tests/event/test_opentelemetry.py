from opentelemetry.trace import NonRecordingSpan, SpanContext, TraceFlags
from opentelemetry.trace.span import TraceState

from arvo_core.event import ArvoEvent, trace_context_from_span

TRACE_ID = 0x0AF7651916CD43DD8448EB211C80319C
SPAN_ID = 0x00F067AA0BA902B7


def minimal_kwargs() -> dict:
    return {
        "subject": "order-42",
        "source": "order-service",
        "type": "order.created",
        "data": {"amount": 100},
        "dataschema": "#/contracts/order",
    }


def test_derives_from_a_span_context_directly() -> None:
    state = TraceState([("vendor", "value")])
    context = SpanContext(
        trace_id=TRACE_ID,
        span_id=SPAN_ID,
        is_remote=False,
        trace_flags=TraceFlags(0x01),
        trace_state=state,
    )
    result = trace_context_from_span(context)
    assert (
        result.traceparent == "00-0af7651916cd43dd8448eb211c80319c-00f067aa0ba902b7-01"
    )
    assert result.tracestate == "vendor=value"


def test_derives_from_a_span_not_just_a_bare_span_context() -> None:
    context = SpanContext(
        trace_id=TRACE_ID,
        span_id=SPAN_ID,
        is_remote=False,
        trace_flags=TraceFlags(0x01),
    )
    span = NonRecordingSpan(context)
    result = trace_context_from_span(span)
    assert (
        result.traceparent == "00-0af7651916cd43dd8448eb211c80319c-00f067aa0ba902b7-01"
    )


def test_no_trace_state_yields_none_not_empty_string() -> None:
    context = SpanContext(
        trace_id=TRACE_ID,
        span_id=SPAN_ID,
        is_remote=False,
        trace_flags=TraceFlags(0x00),
    )
    result = trace_context_from_span(context)
    assert result.tracestate is None


def test_traceparent_and_tracestate_supplied_directly_are_accepted_unvalidated() -> (
    None
):
    event = ArvoEvent(
        **minimal_kwargs(),
        traceparent="not-a-real-w3c-traceparent-but-shape-unchecked",
        tracestate="whatever=this-is-not-validated",
    )
    assert event.traceparent == "not-a-real-w3c-traceparent-but-shape-unchecked"
    assert event.tracestate == "whatever=this-is-not-validated"


def test_no_trace_context_or_span_defaults_both_fields_to_none() -> None:
    event = ArvoEvent(**minimal_kwargs())
    assert event.traceparent is None
    assert event.tracestate is None


def test_trace_context_from_span_resolves_via_lazy_attribute_access() -> None:
    # If arvo_core.event eagerly imported the opentelemetry integration,
    # merely importing arvo_core would already require opentelemetry-api.
    # This test only confirms the lazy attribute actually resolves when
    # asked for -- the "doesn't require it at import time" half is verified
    # by the package being importable at all in an environment without the
    # otel extra, which isn't reproducible from inside this same test suite
    # (opentelemetry-api is a dev dependency here for the tests above).
    import arvo_core.event as event_module

    assert callable(event_module.trace_context_from_span)
