"""Converting an `ArvoEvent` to a wire string."""

from __future__ import annotations

from typing import Literal

from arvo_core.cloudevent import to_cloud_event
from arvo_core.event import ArvoEvent

SerializationMode = Literal["arvoevent", "cloudevent"]


def serialize(event: ArvoEvent, *, mode: SerializationMode = "cloudevent") -> str:
    """Converts `event` to a wire string.

    In `"cloudevent"` mode (the default), the result is the CloudEvent-
    shaped JSON `arvo_core.cloudevent.to_cloud_event` produces. In
    `"arvoevent"` mode, the result is the event's own default JSON shape,
    with no CloudEvent involved.

    Always succeeds for a structurally valid `ArvoEvent`; never raises.
    """
    if mode == "arvoevent":
        return event.model_dump_json()
    return to_cloud_event(event).model_dump_json()
