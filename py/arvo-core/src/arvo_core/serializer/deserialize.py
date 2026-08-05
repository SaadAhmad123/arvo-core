"""Converting a wire string back to an `ArvoEvent`."""

from __future__ import annotations

import json
from typing import Any

from cloudevents.v1.pydantic.v2.event import CloudEvent
from pydantic import ValidationError as PydanticValidationError

from arvo_core.cloudevent import from_cloud_event
from arvo_core.event import ArvoEvent
from arvo_core.event.errors import ArvoEventValidationError
from arvo_core.serializer.errors import ArvoEventSerializerError
from arvo_core.serializer.serialize import SerializationMode


def _parse_object(wire: str) -> dict[str, Any]:
    try:
        parsed = json.loads(wire)
    except json.JSONDecodeError as exc:
        raise ArvoEventSerializerError(f"wire input is not valid JSON: {exc}") from exc
    if not isinstance(parsed, dict):
        raise ArvoEventSerializerError(
            f"wire input must be a JSON object, got {type(parsed).__name__}"
        )
    return parsed


def deserialize(
    wire: str,
    *,
    mode: SerializationMode = "cloudevent",
    **foreign_fallback: Any,
) -> ArvoEvent:
    """Converts `wire` back to an `ArvoEvent`.

    In `"cloudevent"` mode (the default), `wire` is parsed as CloudEvent-
    shaped JSON and reverted via `arvo_core.cloudevent.from_cloud_event`.
    `foreign_fallback` is forwarded to it, for adapting a CloudEvent Arvo
    did not produce. In `"arvoevent"` mode, `wire` is parsed as the
    event's own default JSON shape, with no CloudEvent involved;
    `foreign_fallback` is ignored, since that mode has no foreign-event
    concept.

    Raises:
        ArvoEventSerializerError: if `wire` is not valid JSON, is not a
            JSON object, or does not describe a structurally valid
            `ArvoEvent`.
        CloudEventTransformationError: in `"cloudevent"` mode, if the
            underlying CloudEvent transformation fails. Propagates
            unchanged -- never wrapped in `ArvoEventSerializerError`.
    """
    parsed = _parse_object(wire)
    if mode == "arvoevent":
        try:
            return ArvoEvent(**parsed)
        except ArvoEventValidationError as exc:
            raise ArvoEventSerializerError(str(exc)) from exc
    try:
        ce = CloudEvent.model_validate(parsed)
    except PydanticValidationError as exc:
        raise ArvoEventSerializerError(
            f"wire input is not a valid CloudEvent: {exc}"
        ) from exc
    return from_cloud_event(ce, **foreign_fallback)
