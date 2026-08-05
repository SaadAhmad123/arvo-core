import pytest
from cloudevents.v1.pydantic.v2.event import CloudEvent

from arvo_core.cloudevent import (
    CloudEventTransformationError,
    from_cloud_event,
    to_cloud_event,
)
from arvo_core.cloudevent.constants import DATACONTENTTYPE, DATASCHEMA
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


def _minimal_arvo_shaped_kwargs() -> dict:
    return {
        "id": "1",
        "source": "s",
        "type": "t",
        "subject": "subj",
        "time": "2026-01-01T00:00:00.000Z",
        "specversion": "1.0",
        "datacontenttype": DATACONTENTTYPE,
        "dataschema": DATASCHEMA,
        "data": {
            "arvoeventdata": {},
            "arvoeventdataschema": "#/x",
            "arvoeventbaggage": {},
        },
        "arvoexecutionid": "subj",
        "arvodepth": "0",
    }


def test_arvo_shaped_event_reverses_using_only_its_own_values() -> None:
    for event in (minimal_event(), full_event()):
        ce = to_cloud_event(event)
        back = from_cloud_event(ce, subject="ignored", dataschema="ignored")
        assert back.model_dump(exclude={"time"}) == event.model_dump(exclude={"time"})


def test_missing_required_extension_is_rejected_as_strict_not_foreign() -> None:
    kwargs = _minimal_arvo_shaped_kwargs()
    del kwargs["arvoexecutionid"]
    ce = CloudEvent(**kwargs)
    with pytest.raises(CloudEventTransformationError) as exc_info:
        from_cloud_event(ce)
    assert exc_info.value.kind == "strict"
    assert "arvoexecutionid" in str(exc_info.value)


@pytest.mark.parametrize("malformed_depth", ["01", "-1", "1.0", "abc", ""])
def test_malformed_arvodepth_is_rejected_as_strict(malformed_depth: str) -> None:
    kwargs = _minimal_arvo_shaped_kwargs()
    kwargs["arvodepth"] = malformed_depth
    ce = CloudEvent(**kwargs)
    with pytest.raises(CloudEventTransformationError) as exc_info:
        from_cloud_event(ce)
    assert exc_info.value.kind == "strict"


def test_unexpected_key_in_data_wrapper_is_rejected_as_strict() -> None:
    kwargs = _minimal_arvo_shaped_kwargs()
    kwargs["data"] = {**kwargs["data"], "extra": "nope"}
    ce = CloudEvent(**kwargs)
    with pytest.raises(CloudEventTransformationError) as exc_info:
        from_cloud_event(ce)
    assert exc_info.value.kind == "strict"


def test_dataschema_claim_with_wrong_media_type_is_still_rejected_as_strict() -> None:
    kwargs = _minimal_arvo_shaped_kwargs()
    kwargs["datacontenttype"] = "application/json"
    ce = CloudEvent(**kwargs)
    with pytest.raises(CloudEventTransformationError) as exc_info:
        from_cloud_event(ce)
    assert exc_info.value.kind == "strict"


def test_arvoevents_own_invariant_failure_is_still_rejected_as_strict() -> None:
    # Passes every Arvo-shaped discriminator, but violates ArvoEvent's own
    # root-event invariant: no parentid (root) with a non-zero depth.
    kwargs = _minimal_arvo_shaped_kwargs()
    kwargs["arvodepth"] = "5"
    ce = CloudEvent(**kwargs)
    with pytest.raises(CloudEventTransformationError) as exc_info:
        from_cloud_event(ce)
    assert exc_info.value.kind == "strict"
    assert exc_info.value.__cause__ is not None
