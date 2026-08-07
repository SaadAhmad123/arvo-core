import pytest
from cloudevents.v1.pydantic.v2.event import CloudEvent

from arvo_core.cloudevent import CloudEventTransformationError, from_cloud_event


def _foreign_ce(**overrides: object) -> CloudEvent:
    kwargs: dict = {"id": "f-1", "source": "external-system", "type": "external.event"}
    kwargs.update(overrides)
    return CloudEvent(**kwargs)


def test_foreign_event_adapts_with_complete_fallback() -> None:
    ce = _foreign_ce(subject="subj", data={"x": 1})
    event = from_cloud_event(ce, dataschema="#/foreign")
    assert event.id == "f-1"
    assert event.source == "external-system"
    assert event.type == "external.event"
    assert event.subject == "subj"
    assert event.data == {"x": 1}
    assert event.dataschema == "#/foreign"


def test_foreign_events_own_subject_time_data_win_over_fallback() -> None:
    ce = _foreign_ce(subject="own-subject", data={"own": True})
    event = from_cloud_event(
        ce, subject="fallback-subject", data={"fallback": True}, dataschema="#/x"
    )
    assert event.subject == "own-subject"
    assert event.data == {"own": True}


def test_missing_dataschema_fallback_is_rejected_as_foreign() -> None:
    ce = _foreign_ce(subject="subj", data={"x": 1})
    with pytest.raises(CloudEventTransformationError) as exc_info:
        from_cloud_event(ce)
    assert exc_info.value.kind == "foreign"


def test_present_non_object_data_fails_adaptation_rather_than_being_dropped() -> None:
    ce = _foreign_ce(subject="subj", data="not-an-object")
    with pytest.raises(CloudEventTransformationError) as exc_info:
        from_cloud_event(ce, dataschema="#/x")
    assert exc_info.value.kind == "foreign"


def test_foreign_event_falls_back_when_mappable_fields_are_absent() -> None:
    ce = _foreign_ce(subject=None, time=None, data=None)
    event = from_cloud_event(
        ce, subject="fallback-subject", data={"fallback": True}, dataschema="#/x"
    )
    assert event.subject == "fallback-subject"
    assert event.data == {"fallback": True}


def test_traceparent_and_tracestate_map_when_present_on_a_foreign_event() -> None:
    ce = _foreign_ce(
        subject="subj",
        data={"x": 1},
        traceparent="00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
        tracestate="congo=t61rcWkgMzE",
    )
    event = from_cloud_event(ce, dataschema="#/x")
    assert (
        event.traceparent == "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
    )
    assert event.tracestate == "congo=t61rcWkgMzE"
