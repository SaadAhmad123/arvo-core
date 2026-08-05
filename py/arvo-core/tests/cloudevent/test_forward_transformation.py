from arvo_core.cloudevent import to_cloud_event
from arvo_core.cloudevent.constants import DATACONTENTTYPE, DATASCHEMA, SPECVERSION
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


def test_any_structurally_valid_event_converts_without_raising() -> None:
    to_cloud_event(minimal_event())
    to_cloud_event(full_event())


def test_native_fields_map_unchanged() -> None:
    event = full_event()
    ce = to_cloud_event(event)
    assert ce.id == event.id
    assert ce.source == event.source
    assert ce.type == event.type
    assert ce.subject == event.subject
    assert ce.time is not None


def test_protocol_constants_are_always_set() -> None:
    for event in (minimal_event(), full_event()):
        ce = to_cloud_event(event)
        assert getattr(ce.specversion, "value", ce.specversion) == SPECVERSION
        assert ce.datacontenttype == DATACONTENTTYPE
        assert ce.dataschema == DATASCHEMA


def test_every_non_null_extension_mapped_field_is_present() -> None:
    event = full_event()
    ce = to_cloud_event(event)
    extras = ce.model_extra or {}
    assert extras["arvoparentid"] == event.parentid
    assert extras["arvoinitid"] == event.initid
    assert extras["arvoexecutionid"] == event.executionid
    assert extras["arvocategory"] == event.category
    assert extras["arvoto"] == event.to
    assert extras["arvodomain"] == event.domain
    assert extras["traceparent"] == event.traceparent
    assert extras["tracestate"] == event.tracestate
    assert isinstance(extras["arvodepth"], str)
    assert isinstance(extras["arvoexecutionunits"], str)


def test_arvodepth_is_canonical_for_a_representative_range() -> None:
    for depth in (0, 1, 42, 10**30):
        kwargs = minimal_kwargs()
        if depth != 0:
            kwargs.update(parentid="p", executionid="e", depth=depth)
        ce = to_cloud_event(ArvoEvent(**kwargs))
        extras = ce.model_extra or {}
        assert extras["arvodepth"] == str(depth)


def test_arvoexecutionunits_is_canonical_for_a_representative_range() -> None:
    for value in (0.0, -0.0, 1.5, 1e21, 1e-7, 123456789.123456):
        ce = to_cloud_event(ArvoEvent(**minimal_kwargs(), executionunits=value))
        extras = ce.model_extra or {}
        assert isinstance(extras["arvoexecutionunits"], str)
        assert float(extras["arvoexecutionunits"]) == value


def test_null_nullable_fields_are_omitted_not_present_as_null() -> None:
    event = minimal_event()
    ce = to_cloud_event(event)
    extras = ce.model_extra or {}
    for name in (
        "arvoparentid",
        "arvoinitid",
        "arvocategory",
        "arvoto",
        "arvodomain",
        "arvoexecutionunits",
        "traceparent",
        "tracestate",
    ):
        assert name not in extras


def test_data_wrapper_has_exactly_the_required_shape() -> None:
    event = full_event()
    ce = to_cloud_event(event)
    assert isinstance(ce.data, dict)
    assert set(ce.data.keys()) == {
        "arvoeventdata",
        "arvoeventdataschema",
        "arvoeventbaggage",
    }
    assert ce.data["arvoeventdata"] == event.data
    assert ce.data["arvoeventdataschema"] == event.dataschema
    assert ce.data["arvoeventbaggage"] == event.baggage
