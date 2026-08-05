import pytest

from arvo_core.event import ArvoEvent
from arvo_core.serializer import ArvoEventSerializerError, deserialize, serialize


def minimal_kwargs() -> dict:
    return {
        "subject": "order-42",
        "source": "order-service",
        "type": "order.created",
        "data": {"amount": 100},
        "dataschema": "#/contracts/order",
    }


def minimal_event() -> ArvoEvent:
    return ArvoEvent(**minimal_kwargs())


def test_round_trips_through_arvoevent_mode() -> None:
    event = minimal_event()
    wire = serialize(event, mode="arvoevent")
    back = deserialize(wire, mode="arvoevent")
    assert back.model_dump() == event.model_dump()


def test_non_json_input_raises_with_json_decode_error_cause() -> None:
    with pytest.raises(ArvoEventSerializerError) as exc_info:
        deserialize("not json {{{", mode="arvoevent")
    assert isinstance(exc_info.value.__cause__, ValueError)
    assert type(exc_info.value.__cause__).__name__ == "JSONDecodeError"


def test_top_level_array_raises() -> None:
    with pytest.raises(ArvoEventSerializerError):
        deserialize("[1, 2, 3]", mode="arvoevent")


def test_top_level_scalar_raises() -> None:
    with pytest.raises(ArvoEventSerializerError):
        deserialize('"just a string"', mode="arvoevent")


def test_structurally_invalid_value_raises_with_validation_error_cause() -> None:
    with pytest.raises(ArvoEventSerializerError) as exc_info:
        deserialize('{"foo": "bar"}', mode="arvoevent")
    assert type(exc_info.value.__cause__).__name__ == "ArvoEventValidationError"


def test_fallback_has_no_effect_in_arvoevent_mode() -> None:
    event = minimal_event()
    wire = serialize(event, mode="arvoevent")
    back = deserialize(wire, mode="arvoevent", subject="ignored", dataschema="ignored")
    assert back.subject == event.subject
    assert back.dataschema == event.dataschema
