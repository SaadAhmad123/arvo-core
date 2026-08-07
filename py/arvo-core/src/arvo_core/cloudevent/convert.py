"""ArvoEvent<->CloudEvent transformation."""

from __future__ import annotations

from typing import Any

from cloudevents.v1.pydantic.v2.event import CloudEvent

from arvo_core.cloudevent.codecs import encode_depth, encode_execution_units
from arvo_core.cloudevent.constants import (
    DATACONTENTTYPE,
    DATASCHEMA,
    NULLABLE_EXTENSIONS,
    SPECVERSION,
)
from arvo_core.cloudevent.discriminate import claims_arvo_shape, extract_arvo_fields
from arvo_core.cloudevent.errors import CloudEventTransformationError
from arvo_core.event import ArvoEvent
from arvo_core.event.errors import ArvoEventValidationError


def to_cloud_event(event: ArvoEvent) -> CloudEvent:
    """Converts an `ArvoEvent` into a CloudEvent.

    Total: any structurally valid `ArvoEvent` converts without raising.
    """
    kwargs: dict[str, Any] = {
        "id": event.id,
        "source": event.source,
        "type": event.type,
        "subject": event.subject,
        "time": event.time,
        "specversion": SPECVERSION,
        "datacontenttype": DATACONTENTTYPE,
        "dataschema": DATASCHEMA,
        "data": {
            "arvoeventdata": event.data,
            "arvoeventdataschema": event.dataschema,
            "arvoeventbaggage": event.baggage,
        },
        "arvoexecutionid": event.executionid,
        "arvodepth": encode_depth(event.depth),
    }
    for field_name, extension_name in NULLABLE_EXTENSIONS.items():
        value = getattr(event, field_name)
        if value is not None:
            kwargs[extension_name] = value
    if event.executionunits is not None:
        kwargs["arvoexecutionunits"] = encode_execution_units(event.executionunits)
    if event.traceparent is not None:
        kwargs["traceparent"] = event.traceparent
    if event.tracestate is not None:
        kwargs["tracestate"] = event.tracestate
    return CloudEvent(**kwargs)


def _from_strict(ce: CloudEvent) -> ArvoEvent:
    try:
        fields = extract_arvo_fields(ce)
    except ValueError as exc:
        raise CloudEventTransformationError(str(exc), kind="strict") from exc
    try:
        return ArvoEvent(**fields)
    except ArvoEventValidationError as exc:
        raise CloudEventTransformationError(str(exc), kind="strict") from exc


def _from_foreign(ce: CloudEvent, foreign_fallback: dict[str, Any]) -> ArvoEvent:
    kwargs: dict[str, Any] = dict(foreign_fallback)
    kwargs["id"] = ce.id
    kwargs["source"] = ce.source
    kwargs["type"] = ce.type
    if ce.subject is not None:
        kwargs["subject"] = ce.subject
    if ce.time is not None:
        kwargs["time"] = ce.time.isoformat()
    if ce.data is not None:
        # A non-object `data` is forwarded as-is: `ArvoEvent`'s own
        # construction rejects it with a real type error, which is exactly
        # "fails adaptation rather than being silently discarded" -- no
        # second, duplicate type check needed here.
        kwargs["data"] = ce.data
    extras: dict[str, Any] = ce.model_extra or {}
    if extras.get("traceparent") is not None:
        kwargs["traceparent"] = extras["traceparent"]
    if extras.get("tracestate") is not None:
        kwargs["tracestate"] = extras["tracestate"]
    try:
        return ArvoEvent(**kwargs)
    except ArvoEventValidationError as exc:
        raise CloudEventTransformationError(str(exc), kind="foreign") from exc


def from_cloud_event(ce: CloudEvent, **foreign_fallback: Any) -> ArvoEvent:
    """Converts a CloudEvent into an `ArvoEvent`.

    Partial: not every CloudEvent is a valid ArvoEvent. A CloudEvent
    claiming the Arvo media type or wrapper schema is reconstructed from
    its own values exclusively -- `foreign_fallback` is ignored -- and
    rejected as malformed if it fails any Arvo-shaped condition, never
    silently treated as foreign. Any other CloudEvent is adapted as a
    foreign event: `id`, `source`, and `type` map natively; `subject`,
    `time`, and object-valued `data` map when present and otherwise fall
    back to `foreign_fallback`, which must supply `dataschema` and any
    other field the mapping doesn't provide. A value the CloudEvent itself
    provides always wins over a supplied fallback.

    Raises:
        CloudEventTransformationError: if `ce` cannot be converted, in
            either case, wrapping the original cause.
    """
    if claims_arvo_shape(ce):
        return _from_strict(ce)
    return _from_foreign(ce, foreign_fallback)
