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


# -- Root event rule ------------------------------------------------------


def test_default_construction_satisfies_the_root_event_rule() -> None:
    event = ArvoEvent(**minimal_kwargs())
    assert event.parentid is None
    assert event.executionid == event.subject
    assert event.depth == 0


def test_inconsistent_executionid_on_root_event_is_rejected() -> None:
    kwargs = minimal_kwargs()
    with pytest.raises(ArvoEventValidationError):
        ArvoEvent(**kwargs, executionid="not-the-subject")


def test_inconsistent_depth_on_root_event_is_rejected() -> None:
    kwargs = minimal_kwargs()
    with pytest.raises(ArvoEventValidationError):
        ArvoEvent(**kwargs, depth=1)


def test_non_root_event_may_have_any_consistent_executionid_and_depth() -> None:
    event = ArvoEvent(
        **minimal_kwargs(),
        parentid="parent-event-id",
        executionid="a-different-execution",
        depth=2,
    )
    assert event.executionid == "a-different-execution"
    assert event.depth == 2


# -- Completion correlation rule -----------------------------------------


def test_completion_without_initid_is_rejected() -> None:
    kwargs = minimal_kwargs()
    with pytest.raises(ArvoEventValidationError, match="initid"):
        ArvoEvent(**kwargs, category="io.arvo.complete")


def test_completion_with_initid_succeeds() -> None:
    event = ArvoEvent(
        **minimal_kwargs(), category="io.arvo.complete", initid="the-init-event-id"
    )
    assert event.category == "io.arvo.complete"
    assert event.initid == "the-init-event-id"


def test_non_completion_category_has_no_initid_requirement() -> None:
    event = ArvoEvent(**minimal_kwargs(), category="io.arvo.init")
    assert event.initid is None
