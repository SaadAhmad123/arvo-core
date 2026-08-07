import pydantic
import pytest

from arvo_core.event import ArvoEvent, ArvoEventValidationError

ALL_FIELDS = {
    "id",
    "parentid",
    "initid",
    "subject",
    "executionid",
    "category",
    "depth",
    "source",
    "to",
    "domain",
    "type",
    "data",
    "dataschema",
    "baggage",
    "time",
    "traceparent",
    "tracestate",
    "executionunits",
}


def minimal_kwargs() -> dict:
    return {
        "subject": "order-42",
        "source": "order-service",
        "type": "order.created",
        "data": {"amount": 100},
        "dataschema": "#/contracts/order",
    }


def test_event_exposes_exactly_the_defined_fields() -> None:
    event = ArvoEvent(**minimal_kwargs())
    assert set(type(event).model_fields.keys()) == ALL_FIELDS


def test_unrecognized_key_is_rejected() -> None:
    kwargs = minimal_kwargs()
    with pytest.raises(ArvoEventValidationError, match="bogus"):
        ArvoEvent(**kwargs, bogus="nope")


@pytest.mark.parametrize("missing", ["subject", "source", "type", "data", "dataschema"])
def test_missing_required_input_is_rejected(missing: str) -> None:
    kwargs = minimal_kwargs()
    del kwargs[missing]
    with pytest.raises(ArvoEventValidationError, match=missing):
        ArvoEvent(**kwargs)


def test_all_required_inputs_supplied_succeeds() -> None:
    event = ArvoEvent(**minimal_kwargs())
    assert event.subject == "order-42"


def test_minimal_construction_yields_a_well_formed_root_event() -> None:
    event = ArvoEvent(**minimal_kwargs())
    assert event.parentid is None
    assert event.executionid == event.subject
    assert event.depth == 0
    assert event.baggage == {}
    assert event.category is None
    assert event.to is None
    assert event.domain is None
    assert event.traceparent is None
    assert event.tracestate is None
    assert event.executionunits is None
    assert event.initid is None


def test_generated_ids_are_distinct() -> None:
    a = ArvoEvent(**minimal_kwargs())
    b = ArvoEvent(**minimal_kwargs())
    assert a.id != b.id


def test_default_time_is_z_suffixed() -> None:
    event = ArvoEvent(**minimal_kwargs())
    assert event.time.endswith("Z")
    assert "+00:00" not in event.time


def test_field_assignment_after_construction_raises() -> None:
    event = ArvoEvent(**minimal_kwargs())
    # Mutation isn't wrapped in ArvoEventValidationError -- that guarantee is
    # scoped to construction only (see ArvoEvent's own module docs) -- so
    # this is pydantic's own frozen-instance error, not this package's.
    with pytest.raises(pydantic.ValidationError):
        event.subject = "changed"  # pyrefly: ignore  # deliberately testing the frozen guard
    assert event.subject == "order-42"
