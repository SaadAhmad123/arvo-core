"""Canonical string encodings for fields with no native CloudEvents type."""

from __future__ import annotations

import math
import re
from dataclasses import dataclass

import rfc8785

_DEPTH_PATTERN = re.compile(r"^(0|[1-9]\d*)$", re.ASCII)


def encode_depth(value: int) -> str:
    """`depth` as its canonical unsigned-decimal string."""
    return str(value)


def decode_depth(value: str) -> int | None:
    """Parses a canonical unsigned-decimal string, or `None` if not canonical."""
    if not _DEPTH_PATTERN.match(value):
        return None
    return int(value)


def _rfc8785_number(value: float) -> str:
    # RFC 8785 canonicalizes a whole JSON document, not a bare number; a
    # single-key wrapper isolates just the number's own serialization.
    canonical = rfc8785.dumps({"v": value}).decode()
    return canonical.removeprefix('{"v":').removesuffix("}")


def encode_execution_units(value: float) -> str:
    """`executionunits` as its RFC 8785 canonical number string."""
    return _rfc8785_number(value)


def decode_execution_units(value: str) -> float | None:
    """Parses an RFC 8785 canonical number string.

    Returns `None` if `value` isn't finite or doesn't re-serialize to
    itself -- the round-trip check that rejects a non-canonical spelling
    without a second, stricter number grammar.
    """
    try:
        parsed = float(value)
    except ValueError:
        return None
    if not math.isfinite(parsed):
        return None
    if _rfc8785_number(parsed) != value:
        return None
    return parsed


@dataclass(frozen=True)
class ParsedContentType:
    media_type: str
    params: dict[str, str]


def parse_data_content_type(value: str | None) -> ParsedContentType | None:
    """Splits `datacontenttype` into its media type and parameters.

    The media type and parameter names are lower-cased, per the
    case-insensitive media-type grammar; parameter *values* are left
    as-is, since a `version` parameter's value is case-sensitive.
    """
    if not value:
        return None
    parts = [part.strip() for part in value.split(";")]
    media_type = parts[0].lower()
    if not media_type:
        return None
    params: dict[str, str] = {}
    for part in parts[1:]:
        if "=" not in part:
            continue
        key, _, val = part.partition("=")
        params[key.strip().lower()] = val.strip()
    return ParsedContentType(media_type=media_type, params=params)
