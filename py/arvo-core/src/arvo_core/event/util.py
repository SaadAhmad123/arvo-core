"""Standalone validation helpers used by :mod:`arvo_core.event.model`.

Kept separate from the model itself so the model file stays focused on
field declarations and the `@field_validator`/`@model_validator` wiring
that calls into these.
"""

from __future__ import annotations

import math
from datetime import UTC, datetime
from typing import Any

from hyperlink import parse as parse_uri

JSONScalar = str | int | float | bool | None

_CONTROL_RANGES = ((0x00, 0x1F), (0x7F, 0x9F))
_SURROGATE_RANGE = (0xD800, 0xDFFF)
_NONCHARACTER_RANGE = (0xFDD0, 0xFDEF)


def now_iso() -> str:
    """The current instant as an RFC 3339 UTC timestamp, `Z`-suffixed
    (e.g. `"2026-01-01T00:00:00.000Z"`), not `.isoformat()`'s own
    `+00:00`-suffixed form.
    """
    now = datetime.now(UTC)
    return now.strftime("%Y-%m-%dT%H:%M:%S.") + f"{now.microsecond // 1000:03d}Z"


def _is_excluded_codepoint(codepoint: int) -> bool:
    if any(lo <= codepoint <= hi for lo, hi in _CONTROL_RANGES):
        return True
    if _SURROGATE_RANGE[0] <= codepoint <= _SURROGATE_RANGE[1]:
        return True
    if _NONCHARACTER_RANGE[0] <= codepoint <= _NONCHARACTER_RANGE[1]:
        return True
    # Last two code points of every plane (…FFFE, …FFFF), each plane
    # 0x10000-aligned, so this is exactly the low 16 bits of the code point.
    return (codepoint & 0xFFFE) == 0xFFFE


def check_char_domain(value: str, field_name: str) -> None:
    for ch in value:
        if _is_excluded_codepoint(ord(ch)):
            raise ValueError(
                f"{field_name} contains an excluded character: U+{ord(ch):04X}"
            )


def check_non_empty(value: str, field_name: str) -> None:
    if value == "":
        raise ValueError(f"{field_name} must not be empty")


def validate_cloudevents_string(value: str | None, field_name: str) -> str | None:
    """Char-domain check for a CloudEvents-`String`-domain field, when present."""
    if value is None:
        return None
    check_char_domain(value, field_name)
    return value


def validate_required_string(value: str, field_name: str) -> str:
    check_non_empty(value, field_name)
    check_char_domain(value, field_name)
    return value


def validate_optional_non_empty_string(
    value: str | None, field_name: str
) -> str | None:
    if value is None:
        return None
    check_non_empty(value, field_name)
    check_char_domain(value, field_name)
    return value


def validate_uri_reference(value: str, field_name: str) -> str:
    """RFC 3986 URI-reference, in exact canonical form. Rejects, never normalizes."""
    check_non_empty(value, field_name)
    try:
        normalized = parse_uri(value).normalize().to_uri().to_text()
    except Exception as exc:
        raise ValueError(
            f"{field_name} must be a valid RFC 3986 URI-reference"
        ) from exc
    if normalized != value:
        raise ValueError(
            f"{field_name} must be in RFC 3986 canonical form; a grammatically "
            f"valid but non-canonical value is rejected, not normalized"
        )
    return value


def validate_rfc3339(value: str, field_name: str) -> str:
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError as exc:
        raise ValueError(
            f"{field_name} must be an RFC 3339 timestamp with a UTC offset"
        ) from exc
    if parsed.tzinfo is None:
        raise ValueError(f"{field_name} must include a UTC offset")
    return value


def walk_finite(value: Any, path: str) -> None:
    """Recursively rejects a non-finite number anywhere within `value`."""
    if isinstance(value, bool):
        return
    if isinstance(value, int | float):
        if not math.isfinite(value):
            raise ValueError(f"data{path} must be a finite number")
        return
    if isinstance(value, dict):
        for key, item in value.items():
            walk_finite(item, f"{path}.{key}")
        return
    if isinstance(value, list):
        for index, item in enumerate(value):
            walk_finite(item, f"{path}[{index}]")


def check_flat_scalar_map(value: dict[str, JSONScalar], field_name: str) -> None:
    """Rejects a non-finite float value.

    Flatness and scalar-ness are already guaranteed by the field's own
    `dict[str, JSONScalar]` type -- Pydantic rejects a nested dict/list
    value before this function ever sees it. Finiteness is the one thing
    that type declaration doesn't cover: NaN/Infinity are ordinary floats
    as far as Pydantic's own type system is concerned.
    """
    for key, item in value.items():
        if isinstance(item, float) and not math.isfinite(item):
            raise ValueError(f"{field_name}.{key} must be a finite number")
