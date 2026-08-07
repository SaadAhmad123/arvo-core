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


def _check_protocol_and_native_fields(ce: CloudEvent) -> list[str]:
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

    return errors


def _check_data_wrapper(data: Any) -> list[str]:
    if not (isinstance(data, dict) and set(data.keys()) == DATA_WRAPPER_KEYS):
        return [
            "data must be an object with exactly arvoeventdata, "
            "arvoeventdataschema, and arvoeventbaggage"
        ]

    errors: list[str] = []
    if not isinstance(data.get("arvoeventdata"), dict):
        errors.append("data.arvoeventdata must be an object")
    if (
        not isinstance(data.get("arvoeventdataschema"), str)
        or not data["arvoeventdataschema"]
    ):
        errors.append("data.arvoeventdataschema must be a non-empty string")
    if not isinstance(data.get("arvoeventbaggage"), dict):
        errors.append("data.arvoeventbaggage must be an object")
    return errors


def _extract_executionid(extras: dict[str, Any]) -> tuple[str | None, list[str]]:
    executionid = extras.get(EXECUTIONID_EXTENSION)
    if not isinstance(executionid, str) or not executionid:
        return None, [
            f"{EXECUTIONID_EXTENSION} is required and must be a non-empty string"
        ]
    return executionid, []


def _extract_depth(extras: dict[str, Any]) -> tuple[int | None, list[str]]:
    depth_raw = extras.get(DEPTH_EXTENSION)
    if not isinstance(depth_raw, str):
        return None, [f"{DEPTH_EXTENSION} is required and must be a string"]

    depth = decode_depth(depth_raw)
    if depth is None:
        return None, [
            f"{DEPTH_EXTENSION} is not a canonical unsigned-decimal "
            f"string: {depth_raw!r}"
        ]
    return depth, []


def _check_optional_string_extensions(extras: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    for ext_name in _OPTIONAL_STRING_EXTENSIONS:
        value = extras.get(ext_name)
        if value is not None and not isinstance(value, str):
            errors.append(f"{ext_name} must be a string when present")
    return errors


def _extract_executionunits(extras: dict[str, Any]) -> tuple[float | None, list[str]]:
    raw = extras.get(EXECUTIONUNITS_EXTENSION)
    if raw is None:
        return None, []
    if not isinstance(raw, str):
        return None, [f"{EXECUTIONUNITS_EXTENSION} must be a string when present"]

    executionunits = decode_execution_units(raw)
    if executionunits is None:
        return None, [
            f"{EXECUTIONUNITS_EXTENSION} is not a canonical RFC 8785 "
            f"number string: {raw!r}"
        ]
    return executionunits, []


def extract_arvo_fields(ce: CloudEvent) -> dict[str, Any]:
    """Validates every Arvo-shaped condition and unpacks `ce`'s values.

    Raises `ValueError`, naming every failing condition, if `ce` fails any
    of them. On success, returns a dict of `ArvoEvent` constructor kwargs
    assembled entirely from `ce`'s own values.
    """
    data = ce.data
    extras: dict[str, Any] = ce.model_extra or {}

    executionid, executionid_errors = _extract_executionid(extras)
    depth, depth_errors = _extract_depth(extras)
    executionunits, executionunits_errors = _extract_executionunits(extras)

    errors = [
        *_check_protocol_and_native_fields(ce),
        *_check_data_wrapper(data),
        *executionid_errors,
        *depth_errors,
        *_check_optional_string_extensions(extras),
        *executionunits_errors,
    ]
    if errors:
        raise ValueError("; ".join(errors))

    assert isinstance(data, dict)  # narrowed by `_check_data_wrapper` above
    assert ce.time is not None  # narrowed by `_check_protocol_and_native_fields` above
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
