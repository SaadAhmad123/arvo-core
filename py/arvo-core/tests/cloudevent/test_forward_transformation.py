from collections.abc import Callable

from arvo_core.cloudevent import to_cloud_event
from arvo_core.cloudevent.constants import DATACONTENTTYPE, DATASCHEMA, SPECVERSION
from arvo_core.event import ArvoEvent


def test_any_structurally_valid_event_converts_without_raising(
    minimal_event: ArvoEvent, full_event: ArvoEvent
) -> None:
    to_cloud_event(minimal_event)
    to_cloud_event(full_event)


def test_native_fields_map_unchanged(full_event: ArvoEvent) -> None:
    ce = to_cloud_event(full_event)
    assert ce.id == full_event.id
    assert ce.source == full_event.source
    assert ce.type == full_event.type
    assert ce.subject == full_event.subject
    assert ce.time is not None


def test_protocol_constants_are_always_set(
    minimal_event: ArvoEvent, full_event: ArvoEvent
) -> None:
    for event in (minimal_event, full_event):
        ce = to_cloud_event(event)
        assert getattr(ce.specversion, "value", ce.specversion) == SPECVERSION
        assert ce.datacontenttype == DATACONTENTTYPE
        assert ce.dataschema == DATASCHEMA


def test_every_non_null_extension_mapped_field_is_present(
    full_event: ArvoEvent,
) -> None:
    ce = to_cloud_event(full_event)
    extras = ce.model_extra or {}
    assert extras["arvoparentid"] == full_event.parentid
    assert extras["arvoinitid"] == full_event.initid
    assert extras["arvoexecutionid"] == full_event.executionid
    assert extras["arvocategory"] == full_event.category
    assert extras["arvoto"] == full_event.to
    assert extras["arvodomain"] == full_event.domain
    assert extras["traceparent"] == full_event.traceparent
    assert extras["tracestate"] == full_event.tracestate
    assert isinstance(extras["arvodepth"], str)
    assert isinstance(extras["arvoexecutionunits"], str)


def test_arvodepth_is_canonical_for_a_representative_range(
    minimal_kwargs: Callable[[], dict],
) -> None:
    for depth in (0, 1, 42, 10**30):
        kwargs = minimal_kwargs()
        if depth != 0:
            kwargs.update(parentid="p", executionid="e", depth=depth)
        ce = to_cloud_event(ArvoEvent(**kwargs))
        extras = ce.model_extra or {}
        assert extras["arvodepth"] == str(depth)


def test_arvoexecutionunits_is_canonical_for_a_representative_range(
    minimal_kwargs: Callable[[], dict],
) -> None:
    for value in (0.0, -0.0, 1.5, 1e21, 1e-7, 123456789.123456):
        ce = to_cloud_event(ArvoEvent(**minimal_kwargs(), executionunits=value))
        extras = ce.model_extra or {}
        assert isinstance(extras["arvoexecutionunits"], str)
        assert float(extras["arvoexecutionunits"]) == value


def test_null_nullable_fields_are_omitted_not_present_as_null(
    minimal_event: ArvoEvent,
) -> None:
    ce = to_cloud_event(minimal_event)
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


def test_data_wrapper_has_exactly_the_required_shape(full_event: ArvoEvent) -> None:
    ce = to_cloud_event(full_event)
    assert isinstance(ce.data, dict)
    assert set(ce.data.keys()) == {
        "arvoeventdata",
        "arvoeventdataschema",
        "arvoeventbaggage",
    }
    assert ce.data["arvoeventdata"] == full_event.data
    assert ce.data["arvoeventdataschema"] == full_event.dataschema
    assert ce.data["arvoeventbaggage"] == full_event.baggage
