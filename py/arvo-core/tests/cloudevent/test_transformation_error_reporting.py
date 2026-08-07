import pytest
from cloudevents.v1.pydantic.v2.event import CloudEvent

from arvo_core.cloudevent import CloudEventTransformationError, from_cloud_event
from arvo_core.cloudevent.constants import DATACONTENTTYPE, DATASCHEMA


def _malformed_strict_ce() -> CloudEvent:
    return CloudEvent(
        id="1",
        source="s",
        type="t",
        subject="subj",
        time="2026-01-01T00:00:00.000Z",
        specversion="1.0",
        datacontenttype=DATACONTENTTYPE,
        dataschema=DATASCHEMA,
        data={
            "arvoeventdata": {},
            "arvoeventdataschema": "#/x",
            "arvoeventbaggage": {},
        },
        arvodepth="0",
        # arvoexecutionid deliberately omitted
    )


def _foreign_ce_missing_dataschema() -> CloudEvent:
    return CloudEvent(
        id="f-1", source="ext", type="ext.event", subject="subj", data={"x": 1}
    )


@pytest.mark.parametrize(
    ("build_ce", "call_kwargs", "expected_kind"),
    [
        (_malformed_strict_ce, {}, "strict"),
        (_foreign_ce_missing_dataschema, {}, "foreign"),
    ],
)
def test_failures_are_always_reported_as_cloud_event_transformation_error(
    build_ce, call_kwargs: dict, expected_kind: str
) -> None:
    ce = build_ce()
    with pytest.raises(CloudEventTransformationError) as exc_info:
        from_cloud_event(ce, **call_kwargs)
    assert exc_info.value.kind == expected_kind


def test_cause_is_preserved_for_a_strict_failure() -> None:
    ce = _malformed_strict_ce()
    with pytest.raises(CloudEventTransformationError) as exc_info:
        from_cloud_event(ce)
    assert exc_info.value.__cause__ is not None


def test_cause_is_preserved_for_a_foreign_failure() -> None:
    ce = _foreign_ce_missing_dataschema()
    with pytest.raises(CloudEventTransformationError) as exc_info:
        from_cloud_event(ce)
    assert exc_info.value.__cause__ is not None


def test_kind_is_correct_for_each_failure_case() -> None:
    strict_ce = _malformed_strict_ce()
    with pytest.raises(CloudEventTransformationError) as strict_exc:
        from_cloud_event(strict_ce)
    assert strict_exc.value.kind == "strict"

    foreign_ce = _foreign_ce_missing_dataschema()
    with pytest.raises(CloudEventTransformationError) as foreign_exc:
        from_cloud_event(foreign_ce)
    assert foreign_exc.value.kind == "foreign"
