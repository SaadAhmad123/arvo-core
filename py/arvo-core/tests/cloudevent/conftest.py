from collections.abc import Callable

import pytest

from arvo_core.event import ArvoEvent


def _minimal_kwargs() -> dict:
    return {
        "subject": "order-42",
        "source": "order-service",
        "type": "order.created",
        "data": {"amount": 100},
        "dataschema": "#/contracts/order",
    }


def _full_kwargs() -> dict:
    return {
        **_minimal_kwargs(),
        "id": "evt-1",
        "parentid": "parent-1",
        "initid": "init-1",
        "executionid": "exec-1",
        "category": "io.arvo.custom",
        "depth": 3,
        "to": "downstream-service",
        "domain": "special-domain",
        "baggage": {"tenant": "acme", "attempt": 2, "retryable": True},
        "time": "2026-01-01T00:00:00.000Z",
        "traceparent": "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
        "tracestate": "congo=t61rcWkgMzE",
        "executionunits": 1.5,
    }


@pytest.fixture
def minimal_kwargs() -> Callable[[], dict]:
    """A fresh copy of the minimal-required-fields kwargs dict, per call."""
    return _minimal_kwargs


@pytest.fixture
def full_kwargs() -> Callable[[], dict]:
    """A fresh copy of the every-field-populated kwargs dict, per call."""
    return _full_kwargs


@pytest.fixture
def minimal_event() -> ArvoEvent:
    return ArvoEvent(**_minimal_kwargs())


@pytest.fixture
def full_event() -> ArvoEvent:
    return ArvoEvent(**_full_kwargs())
