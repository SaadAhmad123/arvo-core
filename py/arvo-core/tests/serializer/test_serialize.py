import json

from arvo_core.cloudevent import to_cloud_event
from arvo_core.event import ArvoEvent
from arvo_core.serializer import serialize


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


def test_serialize_does_not_raise_in_either_mode() -> None:
    event = minimal_event()
    serialize(event, mode="arvoevent")
    serialize(event, mode="cloudevent")
    serialize(event)


def test_arvoevent_mode_output_is_the_events_own_default_json_shape() -> None:
    event = minimal_event()
    wire = serialize(event, mode="arvoevent")
    back = ArvoEvent.model_validate_json(wire)
    assert back.model_dump() == event.model_dump()


def test_cloudevent_mode_output_matches_to_cloud_events_own_field_placement() -> None:
    event = minimal_event()
    wire = serialize(event, mode="cloudevent")
    parsed = json.loads(wire)
    expected = json.loads(to_cloud_event(event).model_dump_json())
    assert parsed == expected


def test_default_mode_is_cloudevent() -> None:
    event = minimal_event()
    assert serialize(event) == serialize(event, mode="cloudevent")
