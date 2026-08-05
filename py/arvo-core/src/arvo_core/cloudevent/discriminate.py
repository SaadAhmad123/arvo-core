"""Recognizing and unpacking an Arvo-shaped CloudEvent."""

from __future__ import annotations

from typing import Any

from cloudevents.v1.pydantic.v2.event import CloudEvent

from arvo_core.cloudevent.codecs import (
    decode_depth,
    decode_execution_units,
    parse_data_content_type,
)
from arvo_core.cloudevent.constants import (
    ARVO_MEDIA_TYPE,
    DATA_WRAPPER_KEYS,
    DATASCHEMA,
    DEPTH_EXTENSION,
    EXECUTIONID_EXTENSION,
    EXECUTIONUNITS_EXTENSION,
    NULLABLE_EXTENSIONS,
    SPECVERSION,
    TRACING_EXTENSIONS,
)

_OPTIONAL_STRING_EXTENSIONS = (*NULLABLE_EXTENSIONS.values(), *TRACING_EXTENSIONS)


def claims_arvo_shape(ce: CloudEvent) -> bool:
    """Whether `ce` claims to be Arvo-shaped via its media type or wrapper schema.

    A CloudEvent matching either signal MUST be routed to strict handling
    even if it turns out malformed -- it must never silently fall back to
    foreign-event adaptation. This function answers only the routing
    question; `extract_arvo_fields` checks every full discriminator.
    """
    parsed = parse_data_content_type(ce.datacontenttype)
    media_match = parsed is not None and parsed.media_type == ARVO_MEDIA_TYPE
    schema_match = ce.dataschema == DATASCHEMA
    return media_match or schema_match


def extract_arvo_fields(ce: CloudEvent) -> dict[str, Any]:
    """Validates every Arvo-shaped condition and unpacks `ce`'s values.

    Raises `ValueError`, naming every failing condition, if `ce` fails any
    of them. On success, returns a dict of `ArvoEvent` constructor kwargs
    assembled entirely from `ce`'s own values.
    """
    errors: list[str] = []

    specversion = getattr(ce.specversion, "value", ce.specversion)
    if specversion != SPECVERSION:
        errors.append(f"specversion must be {SPECVERSION!r}, got {specversion!r}")

    parsed_ct = parse_data_content_type(ce.datacontenttype)
    if parsed_ct is None or parsed_ct.media_type != ARVO_MEDIA_TYPE:
        errors.append(f"datacontenttype must have media type {ARVO_MEDIA_TYPE!r}")
    elif parsed_ct.params != {"version": "1"}:
        errors.append(
            "datacontenttype must have exactly one parameter, version=1, "
            f"got {parsed_ct.params!r}"
        )

    if ce.dataschema != DATASCHEMA:
        errors.append(f"dataschema must be {DATASCHEMA!r}, got {ce.dataschema!r}")

    if not isinstance(ce.subject, str) or not ce.subject:
        errors.append("subject is required and must be a non-empty string")

    if ce.time is None:
        errors.append("time is required")

    data = ce.data
    wrapper_ok = isinstance(data, dict) and set(data.keys()) == DATA_WRAPPER_KEYS
    if not wrapper_ok:
        errors.append(
            "data must be an object with exactly arvoeventdata, "
            "arvoeventdataschema, and arvoeventbaggage"
        )
    else:
        if not isinstance(data.get("arvoeventdata"), dict):
            errors.append("data.arvoeventdata must be an object")
        if (
            not isinstance(data.get("arvoeventdataschema"), str)
            or not data["arvoeventdataschema"]
        ):
            errors.append("data.arvoeventdataschema must be a non-empty string")
        if not isinstance(data.get("arvoeventbaggage"), dict):
            errors.append("data.arvoeventbaggage must be an object")

    extras: dict[str, Any] = ce.model_extra or {}

    executionid = extras.get(EXECUTIONID_EXTENSION)
    if not isinstance(executionid, str) or not executionid:
        errors.append(
            f"{EXECUTIONID_EXTENSION} is required and must be a non-empty string"
        )

    depth_raw = extras.get(DEPTH_EXTENSION)
    depth: int | None = None
    if not isinstance(depth_raw, str):
        errors.append(f"{DEPTH_EXTENSION} is required and must be a string")
    else:
        depth = decode_depth(depth_raw)
        if depth is None:
            errors.append(
                f"{DEPTH_EXTENSION} is not a canonical unsigned-decimal "
                f"string: {depth_raw!r}"
            )

    for ext_name in _OPTIONAL_STRING_EXTENSIONS:
        value = extras.get(ext_name)
        if value is not None and not isinstance(value, str):
            errors.append(f"{ext_name} must be a string when present")

    executionunits_raw = extras.get(EXECUTIONUNITS_EXTENSION)
    executionunits: float | None = None
    if executionunits_raw is not None:
        if not isinstance(executionunits_raw, str):
            errors.append(f"{EXECUTIONUNITS_EXTENSION} must be a string when present")
        else:
            executionunits = decode_execution_units(executionunits_raw)
            if executionunits is None:
                errors.append(
                    f"{EXECUTIONUNITS_EXTENSION} is not a canonical RFC 8785 "
                    f"number string: {executionunits_raw!r}"
                )

    if errors:
        raise ValueError("; ".join(errors))

    assert isinstance(data, dict)  # narrowed by `wrapper_ok` above
    assert ce.time is not None  # narrowed by the "time is required" check above
    return {
        "id": ce.id,
        "parentid": extras.get("arvoparentid"),
        "initid": extras.get("arvoinitid"),
        "subject": ce.subject,
        "executionid": executionid,
        "category": extras.get("arvocategory"),
        "depth": depth,
        "source": ce.source,
        "to": extras.get("arvoto"),
        "domain": extras.get("arvodomain"),
        "type": ce.type,
        "data": data["arvoeventdata"],
        "dataschema": data["arvoeventdataschema"],
        "baggage": data["arvoeventbaggage"],
        "time": ce.time.isoformat(),
        "traceparent": extras.get("traceparent"),
        "tracestate": extras.get("tracestate"),
        "executionunits": executionunits,
    }
