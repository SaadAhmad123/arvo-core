"""The ArvoEvent model: the event exchanged between participants in an Arvo app."""

from __future__ import annotations

import math
from typing import Any
from uuid import uuid4

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    ValidationError,
    field_validator,
    model_validator,
)

from arvo_core.event.errors import ArvoEventValidationError
from arvo_core.event.util import (
    JSONScalar,
    check_flat_scalar_map,
    now_iso,
    validate_cloudevents_string,
    validate_optional_non_empty_string,
    validate_required_string,
    validate_rfc3339,
    validate_uri_reference,
    walk_finite,
)


class ArvoEvent(BaseModel):
    """An event exchanged between participants in an event-driven application.

    Only `subject`, `source`, `type`, `data`, and `dataschema` are required;
    every other field is defaulted or derived automatically. An `ArvoEvent`
    is structurally valid by construction — an instance cannot exist unless
    every field satisfies its own rule — and immutable once built: no field
    can be reassigned afterward.

    Example:
        ```python
        event = ArvoEvent(
            subject="order-42",
            source="order-service",
            type="order.created",
            data={"amount": 100},
            dataschema="#/contracts/order",
        )
        event.id       # a fresh, random identifier
        event.time     # e.g. "2026-01-01T00:00:00.000Z"
        event.executionid  # equals `subject` on a root event
        ```

    Raises:
        ArvoEventValidationError: if construction fails. The message names
            every field that was invalid and why.
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    id: str = Field(
        default_factory=lambda: str(uuid4()),
        description="Identifies this event. Defaults to a random, unique value.",
    )
    parentid: str | None = Field(
        default=None,
        description="The `id` of the event that directly caused this one. "
        "`None` marks a root event.",
    )
    initid: str | None = Field(
        default=None,
        description="The `id` of the request this event answers. Only meaningful, "
        "and required, on a completion event.",
    )
    subject: str = Field(description="The workflow this event belongs to. Required.")
    executionid: str = Field(
        default="",
        description="This event's execution identity. Defaults to `subject`.",
    )
    category: str | None = Field(
        default=None,
        description="This event's role, e.g. `'io.arvo.init'` or `'io.arvo.complete'`. "
        "Any other value, or `None`, is application-defined.",
    )
    depth: int = Field(
        default=0,
        ge=0,
        description="This event's nesting level, measured from the root. "
        "Must be a non-negative integer.",
    )
    source: str = Field(
        description="Identifies the producer of this event. Required. Must be a "
        "non-empty string already in canonical RFC 3986 URI-reference form "
        "(e.g. `'order-service'`, `'api/users'`, `'https://example.com/'`) — a "
        "valid but non-canonical value (wrong case, non-canonical percent-encoding) "
        "is rejected, not normalized."
    )
    to: str | None = Field(
        default=None, description="The intended recipient of this event."
    )
    domain: str | None = Field(
        default=None,
        description="Marks an event that must be handled outside its current "
        "deployment. `None` (the default) means ordinary traffic.",
    )
    type: str = Field(description="This event's type name. Required.")
    data: dict[str, Any] = Field(
        description="This event's JSON-serializable payload. Required. Every "
        "number anywhere within it, at any depth, must be finite."
    )
    dataschema: str = Field(
        description="Identifies the exact contract this event relates to. Required. "
        "Same canonical RFC 3986 URI-reference rule as `source`."
    )
    baggage: dict[str, JSONScalar] = Field(
        default_factory=dict,
        description="Ambient context carried unchanged across an entire workflow: "
        "a flat map of scalars, with no nesting at any depth.",
    )
    time: str = Field(
        default_factory=now_iso,
        description="RFC 3339 timestamp of when the event occurred, with a UTC "
        "offset. Defaults to the current instant. Descriptive only — never "
        "used to establish ordering.",
    )
    traceparent: str | None = Field(
        default=None, description="W3C trace-context `traceparent` header value."
    )
    tracestate: str | None = Field(
        default=None, description="W3C trace-context `tracestate` header value."
    )
    executionunits: float | None = Field(
        default=None,
        description="An opaque numeric value whose meaning is defined entirely "
        "by whoever emits the event. Must be finite when not `None`.",
    )

    @model_validator(mode="before")
    @classmethod
    def _default_executionid(cls, data: Any) -> Any:
        # Only inject a default when `subject` itself is actually present --
        # otherwise this would inject `executionid: None`, producing a
        # confusing second "must be a valid string" error alongside the
        # real "subject: Field required" one.
        if (
            isinstance(data, dict)
            and not data.get("executionid")
            and data.get("subject")
        ):
            data = {**data, "executionid": data["subject"]}
        return data

    @field_validator("id", "subject", "type")
    @classmethod
    def _validate_required_strings(cls, value: str, info: Any) -> str:
        return validate_required_string(value, info.field_name)

    @field_validator("executionid")
    @classmethod
    def _validate_executionid(cls, value: str) -> str:
        return validate_required_string(value, "executionid")

    @field_validator("parentid", "initid", "category", "to", "domain")
    @classmethod
    def _validate_optional_strings(cls, value: str | None, info: Any) -> str | None:
        return validate_optional_non_empty_string(value, info.field_name)

    @field_validator("traceparent", "tracestate")
    @classmethod
    def _validate_trace_strings(cls, value: str | None, info: Any) -> str | None:
        return validate_cloudevents_string(value, info.field_name)

    @field_validator("source", "dataschema")
    @classmethod
    def _validate_uri_fields(cls, value: str, info: Any) -> str:
        return validate_uri_reference(value, info.field_name)

    @field_validator("time")
    @classmethod
    def _validate_time(cls, value: str) -> str:
        return validate_rfc3339(value, "time")

    @field_validator("executionunits")
    @classmethod
    def _validate_executionunits(cls, value: float | None) -> float | None:
        if value is not None and not math.isfinite(value):
            raise ValueError("executionunits must be a finite number")
        return value

    @field_validator("data")
    @classmethod
    def _validate_data(cls, value: dict[str, Any]) -> dict[str, Any]:
        walk_finite(value, "")
        return value

    @field_validator("baggage")
    @classmethod
    def _validate_baggage(cls, value: dict[str, JSONScalar]) -> dict[str, JSONScalar]:
        check_flat_scalar_map(value, "baggage")
        return value

    @model_validator(mode="after")
    def _check_root_event(self) -> ArvoEvent:
        if self.parentid is None and (
            self.executionid != self.subject or self.depth != 0
        ):
            raise ValueError(
                "a root event (parentid=None) must have "
                "executionid == subject and depth == 0"
            )
        return self

    @model_validator(mode="after")
    def _check_completion_correlation(self) -> ArvoEvent:
        if self.category == "io.arvo.complete" and self.initid is None:
            raise ValueError(
                "a completion event (category='io.arvo.complete') "
                "must have a non-null initid"
            )
        return self

    def __init__(self, **data: Any) -> None:
        try:
            super().__init__(**data)
        except ValidationError as exc:
            raise ArvoEventValidationError.from_pydantic(exc) from exc
