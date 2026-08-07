import math

import pytest

from arvo_core.event import ArvoEvent, ArvoEventValidationError


def minimal_kwargs() -> dict:
    return {
        "subject": "order-42",
        "source": "order-service",
        "type": "order.created",
        "data": {"amount": 100},
        "dataschema": "#/contracts/order",
    }


# -- URI-reference canonical form (source / dataschema) --------------------

CANONICAL_URI_REFERENCES = [
    "order-service",
    "api/users",
    "https://example.com/",
    "#/contracts/user",
]


@pytest.mark.parametrize("field", ["source", "dataschema"])
@pytest.mark.parametrize("value", CANONICAL_URI_REFERENCES)
def test_canonical_uri_reference_accepted_unchanged(field: str, value: str) -> None:
    kwargs = minimal_kwargs()
    kwargs[field] = value
    event = ArvoEvent(**kwargs)
    assert getattr(event, field) == value


NON_CANONICAL_VALUES = [
    "HTTPS://Example.COM/",  # mixed-case scheme/host
    "https://example.com/%7euser",  # non-canonical percent-encoding (lowercase hex)
    "https://example.com/../a",  # unresolved dot-segment
]


@pytest.mark.parametrize("field", ["source", "dataschema"])
@pytest.mark.parametrize("value", NON_CANONICAL_VALUES)
def test_non_canonical_but_grammatically_valid_value_is_rejected(
    field: str, value: str
) -> None:
    kwargs = minimal_kwargs()
    kwargs[field] = value
    with pytest.raises(ArvoEventValidationError, match="canonical form"):
        ArvoEvent(**kwargs)


@pytest.mark.parametrize("field", ["source", "dataschema"])
def test_empty_uri_reference_is_rejected(field: str) -> None:
    kwargs = minimal_kwargs()
    kwargs[field] = ""
    with pytest.raises(ArvoEventValidationError):
        ArvoEvent(**kwargs)


@pytest.mark.parametrize("field", ["source", "dataschema"])
def test_a_value_the_uri_parser_itself_rejects_is_rejected(field: str) -> None:
    kwargs = minimal_kwargs()
    kwargs[field] = "http://[invalid-ipv6"
    with pytest.raises(ArvoEventValidationError, match="RFC 3986 URI-reference"):
        ArvoEvent(**kwargs)


# -- String character-domain exclusion --------------------------------------


@pytest.mark.parametrize(
    "excluded_char",
    [
        "\x00",  # control character
        "﷐",  # Unicode noncharacter
        "\ud800",  # unpaired surrogate
    ],
)
def test_excluded_character_is_rejected(excluded_char: str) -> None:
    kwargs = minimal_kwargs()
    kwargs["type"] = f"order{excluded_char}created"
    with pytest.raises(ArvoEventValidationError, match="type"):
        ArvoEvent(**kwargs)


# -- executionunits: finite ---------------------------------------------


@pytest.mark.parametrize("value", [0.0, 1.5, -1000.0, 1e300])
def test_finite_executionunits_accepted(value: float) -> None:
    event = ArvoEvent(**minimal_kwargs(), executionunits=value)
    assert event.executionunits == value


@pytest.mark.parametrize("value", [math.nan, math.inf, -math.inf])
def test_non_finite_executionunits_rejected(value: float) -> None:
    kwargs = minimal_kwargs()
    with pytest.raises(ArvoEventValidationError, match="executionunits"):
        ArvoEvent(**kwargs, executionunits=value)


# -- JSON validity of data / baggage -----------------------------------------


def test_non_finite_number_nested_in_data_is_rejected() -> None:
    kwargs = minimal_kwargs()
    kwargs["data"] = {"items": [{"price": math.nan}]}
    with pytest.raises(ArvoEventValidationError, match="data"):
        ArvoEvent(**kwargs)


def test_finite_number_nested_in_data_is_accepted() -> None:
    kwargs = minimal_kwargs()
    kwargs["data"] = {"items": [{"price": 12.5}]}
    event = ArvoEvent(**kwargs)
    assert event.data["items"][0]["price"] == 12.5


def test_boolean_value_in_data_is_not_treated_as_a_number() -> None:
    kwargs = minimal_kwargs()
    kwargs["data"] = {"flag": True, "items": [False, True]}
    event = ArvoEvent(**kwargs)
    assert event.data["flag"] is True


def test_non_numeric_scalars_in_data_are_left_untouched() -> None:
    kwargs = minimal_kwargs()
    kwargs["data"] = {"name": "hello", "items": [1, 2, 3]}
    event = ArvoEvent(**kwargs)
    assert event.data["name"] == "hello"


def test_nested_object_value_in_baggage_is_rejected() -> None:
    kwargs = minimal_kwargs()
    with pytest.raises(ArvoEventValidationError, match="baggage"):
        ArvoEvent(**kwargs, baggage={"tenant": {"nested": True}})


def test_nested_array_value_in_baggage_is_rejected() -> None:
    kwargs = minimal_kwargs()
    with pytest.raises(ArvoEventValidationError, match="baggage"):
        ArvoEvent(**kwargs, baggage={"tenant": [1, 2, 3]})


def test_non_finite_scalar_value_in_baggage_is_rejected() -> None:
    kwargs = minimal_kwargs()
    with pytest.raises(ArvoEventValidationError, match="baggage"):
        ArvoEvent(**kwargs, baggage={"score": math.nan})


def test_flat_scalar_baggage_is_accepted() -> None:
    event = ArvoEvent(
        **minimal_kwargs(),
        baggage={"tenant": "acme", "count": 3, "active": True, "note": None},
    )
    assert event.baggage == {"tenant": "acme", "count": 3, "active": True, "note": None}


# -- time: RFC 3339 with a UTC offset ----------------------------------------


def test_explicit_time_with_z_offset_is_accepted() -> None:
    event = ArvoEvent(**minimal_kwargs(), time="2026-01-01T00:00:00.000Z")
    assert event.time == "2026-01-01T00:00:00.000Z"


def test_explicit_time_with_numeric_offset_is_accepted() -> None:
    event = ArvoEvent(**minimal_kwargs(), time="2026-01-01T00:00:00+05:00")
    assert event.time == "2026-01-01T00:00:00+05:00"


def test_time_that_is_not_a_valid_timestamp_at_all_is_rejected() -> None:
    kwargs = minimal_kwargs()
    with pytest.raises(ArvoEventValidationError, match="time"):
        ArvoEvent(**kwargs, time="not a timestamp")


def test_time_with_no_offset_is_rejected() -> None:
    kwargs = minimal_kwargs()
    with pytest.raises(ArvoEventValidationError, match="UTC offset"):
        ArvoEvent(**kwargs, time="2026-01-01T00:00:00")


# -- Explicit None on nullable optional-string fields ------------------------
# (Pydantic only runs a field validator on a default value if explicitly
# passed -- these exercise that code path directly, distinct from simply
# omitting the field.)


def test_explicit_none_traceparent_and_tracestate_are_accepted() -> None:
    event = ArvoEvent(**minimal_kwargs(), traceparent=None, tracestate=None)
    assert event.traceparent is None
    assert event.tracestate is None


def test_explicit_none_on_optional_arvo_fields_is_accepted() -> None:
    event = ArvoEvent(
        **minimal_kwargs(),
        parentid=None,
        initid=None,
        category=None,
        to=None,
        domain=None,
    )
    assert event.parentid is None
    assert event.category is None
