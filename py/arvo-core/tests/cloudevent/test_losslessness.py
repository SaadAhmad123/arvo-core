from datetime import datetime
from typing import Any

from arvo_core.cloudevent import from_cloud_event, to_cloud_event
from arvo_core.event import ArvoEvent


def minimal_kwargs() -> dict:
    return {
        "subject": "order-42",
        "source": "order-service",
        "type": "order.created",
        "data": {"amount": 100},
        "dataschema": "#/contracts/order",
    }


def full_kwargs() -> dict:
    return {
        **minimal_kwargs(),
        "id": "evt-1",
        "parentid": "parent-1",
        "initid": "init-1",
        "executionid": "exec-1",
        "category": "io.arvo.custom",
        "depth": 3,
        "to": "downstream-service",
        "domain": "special-domain",
        "baggage": {"tenant": "acme", "attempt": 2, "retryable": True},
        "time": "2026-01-01T00:00:00.000Z",
        "traceparent": "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
        "tracestate": "congo=t61rcWkgMzE",
        "executionunits": 1.5,
    }


def minimal_event() -> ArvoEvent:
    return ArvoEvent(**minimal_kwargs())


def full_event() -> ArvoEvent:
    return ArvoEvent(**full_kwargs())


def test_fully_populated_event_round_trips_except_time() -> None:
    event = full_event()
    back = from_cloud_event(to_cloud_event(event))
    assert back.model_dump(exclude={"time"}) == event.model_dump(exclude={"time"})


def test_minimal_event_round_trips_except_time() -> None:
    event = minimal_event()
    back = from_cloud_event(to_cloud_event(event))
    assert back.model_dump(exclude={"time"}) == event.model_dump(exclude={"time"})


def test_non_default_non_utc_time_round_trips_to_the_same_instant() -> None:
    event = ArvoEvent(
        subject="s",
        source="src",
        type="t",
        data={},
        dataschema="#/x",
        time="2026-01-01T12:00:00.5+05:30",
    )
    back = from_cloud_event(to_cloud_event(event))
    assert datetime.fromisoformat(back.time) == datetime.fromisoformat(event.time)
    assert back.time != event.time


def test_depth_round_trips_exactly_at_representative_magnitudes() -> None:
    for depth in (0, 1, 42, 10**30):
        kwargs: dict[str, Any] = {
            "subject": "s",
            "source": "src",
            "type": "t",
            "data": {},
            "dataschema": "#/x",
        }
        if depth != 0:
            kwargs.update(parentid="p", executionid="e", depth=depth)
        event = ArvoEvent(**kwargs)
        back = from_cloud_event(to_cloud_event(event))
        assert back.depth == depth


def test_executionunits_round_trips_exactly_at_representative_magnitudes() -> None:
    for value in (0.0, -0.0, 1.5, 1e21, 1e-7, 123456789.123456):
        event = ArvoEvent(
            subject="s",
            source="src",
            type="t",
            data={},
            dataschema="#/x",
            executionunits=value,
        )
        back = from_cloud_event(to_cloud_event(event))
        assert back.executionunits == value
