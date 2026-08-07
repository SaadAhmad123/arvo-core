from datetime import datetime
from typing import Any

from arvo_core.cloudevent import from_cloud_event, to_cloud_event
from arvo_core.event import ArvoEvent


def test_fully_populated_event_round_trips_except_time(full_event: ArvoEvent) -> None:
    back = from_cloud_event(to_cloud_event(full_event))
    assert back.model_dump(exclude={"time"}) == full_event.model_dump(exclude={"time"})


def test_minimal_event_round_trips_except_time(minimal_event: ArvoEvent) -> None:
    back = from_cloud_event(to_cloud_event(minimal_event))
    assert back.model_dump(exclude={"time"}) == minimal_event.model_dump(
        exclude={"time"}
    )


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
