import pytest

from arvo_core.cloudevent import CloudEventTransformationError
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


def test_round_trips_through_cloudevent_mode_except_time() -> None:
    event = minimal_event()
    wire = serialize(event, mode="cloudevent")
    back = deserialize(wire, mode="cloudevent")
    assert back.model_dump(exclude={"time"}) == event.model_dump(exclude={"time"})


def test_default_mode_is_cloudevent() -> None:
    event = minimal_event()
    wire = serialize(event)
    back = deserialize(wire)
    assert back.model_dump(exclude={"time"}) == event.model_dump(exclude={"time"})


def test_non_json_input_raises() -> None:
    with pytest.raises(ArvoEventSerializerError):
        deserialize("not json {{{")


def test_top_level_array_raises() -> None:
    with pytest.raises(ArvoEventSerializerError):
        deserialize("[1, 2, 3]")


def test_value_that_cannot_become_a_cloud_event_raises() -> None:
    with pytest.raises(ArvoEventSerializerError) as exc_info:
        deserialize('{"foo": "bar"}')
    assert exc_info.value.__cause__ is not None


def test_arvoevent_mode_wire_fed_to_cloudevent_mode_fails_clearly() -> None:
    event = minimal_event()
    wire = serialize(event, mode="arvoevent")
    with pytest.raises((ArvoEventSerializerError, CloudEventTransformationError)):
        deserialize(wire, mode="cloudevent")


def test_foreign_cloud_event_adapts_with_fallback() -> None:
    wire = '{"id":"f1","source":"ext","type":"ext.event","data":{"x":1}}'
    event = deserialize(wire, subject="s", dataschema="#/foreign")
    assert event.subject == "s"
    assert event.dataschema == "#/foreign"
    assert event.data == {"x": 1}


def test_malformed_arvo_shaped_wire_raises_unwrapped_transformation_error() -> None:
    wire = (
        '{"id":"1","source":"s","type":"t","subject":"s",'
        '"time":"2026-01-01T00:00:00Z","specversion":"1.0",'
        '"datacontenttype":"application/vnd.arvo.event+json;version=1",'
        '"dataschema":"https://www.arvo.land/schemas/cloudevent-data/v1",'
        '"data":{"arvoeventdata":{},"arvoeventdataschema":"#/x","arvoeventbaggage":{}},'
        '"arvoexecutionid":"s","arvodepth":"007"}'
    )
    with pytest.raises(CloudEventTransformationError) as exc_info:
        deserialize(wire)
    assert exc_info.value.kind == "strict"
