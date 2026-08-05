"""A scratch pad for trying out arvo-core (py) as it currently exists on
disk -- not the last published PyPI release.

`arvo-core` is linked here as an editable install pointing at
`../arvo-core`, so this always sees whatever is currently in
`py/arvo-core/src/` -- no build or publish step needed; edit and re-run.

Run with `uv run sandbox`.
"""

from cloudevents.v1.pydantic.v2.event import CloudEvent

from arvo_core.cloudevent import from_cloud_event, to_cloud_event
from arvo_core.event import ArvoEvent, trace_context_from_span

from sandbox.otel import shutdown_otel, tracer


def main() -> None:
    with tracer.start_as_current_span("order.created") as span:
        span.set_attribute("order.id", "order-42")
        ctx = trace_context_from_span(span)

        event = ArvoEvent(
            subject="order-42",
            source="order-service",
            type="order.created",
            data={"amount": 100},
            dataschema="#/contracts/order",
            traceparent=ctx.traceparent,
            tracestate=ctx.tracestate,
        )

    print("span context:", span.get_span_context())
    print("traceparent:", event.traceparent)
    print("tracestate:", event.tracestate)
    print("wire:", event.model_dump_json())

    cloud_event = to_cloud_event(event)
    print("cloudevent wire:", cloud_event.model_dump_json())

    recovered = from_cloud_event(cloud_event)
    round_trips = recovered.model_dump(exclude={"time"}) == event.model_dump(exclude={"time"})
    print("round trip matches (minus time):", round_trips)

    foreign = CloudEvent(
        id="webhook-1",
        source="https://github.com/acme/repo",
        type="com.github.push",
        data={"ref": "refs/heads/main"},
    )
    adapted = from_cloud_event(
        foreign, subject="acme/repo", dataschema="#/contracts/github-push"
    )
    print("adapted foreign event:", adapted.model_dump_json())

    shutdown_otel()
