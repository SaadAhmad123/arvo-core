import math

import pydantic
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


@pytest.mark.parametrize(
    "broken_kwargs",
    [
        {"subject": None},  # missing/wrong-type required field
        {"source": "HTTPS://Example.COM/"},  # non-canonical URI
        {"executionunits": math.nan},  # non-finite executionunits
        {"data": {"x": math.inf}},  # non-finite nested in data
        {"baggage": {"x": {"nested": True}}},  # nested value in baggage
        {"category": "io.arvo.complete"},  # missing initid for a completion
    ],
)
def test_every_failure_is_arvo_event_validation_error_with_original_cause(
    broken_kwargs: dict,
) -> None:
    kwargs = minimal_kwargs()
    kwargs.update(broken_kwargs)

    with pytest.raises(ArvoEventValidationError) as excinfo:
        ArvoEvent(**kwargs)

    error = excinfo.value
    assert error.__cause__ is not None
    assert isinstance(error.__cause__, pydantic.ValidationError)


def test_message_names_the_failing_field() -> None:
    kwargs = minimal_kwargs()
    del kwargs["dataschema"]
    with pytest.raises(ArvoEventValidationError, match="dataschema") as excinfo:
        ArvoEvent(**kwargs)
    assert "dataschema" in str(excinfo.value)


def test_multiple_failures_are_all_named_in_one_message() -> None:
    with pytest.raises(ArvoEventValidationError) as excinfo:
        ArvoEvent(subject="", source="", type="", data={}, dataschema="")
    message = str(excinfo.value)
    # Every offending field appears somewhere in the combined message.
    for field in ("source", "type", "dataschema"):
        assert field in message
