"""Errors raised by :mod:`arvo_core.cloudevent`."""

from __future__ import annotations

from typing import Literal


class CloudEventTransformationError(Exception):
    """Raised when converting between an ArvoEvent and a CloudEvent fails.

    `kind` identifies which reverse case produced the error: `"strict"`
    means the CloudEvent claimed to be Arvo-shaped but wasn't a valid one,
    and `"foreign"` means adapting it as a non-Arvo CloudEvent failed.
    Always raised as ``raise CloudEventTransformationError(...) from
    original_error``, so the original error is preserved as ``__cause__``.
    """

    def __init__(self, message: str, *, kind: Literal["strict", "foreign"]) -> None:
        super().__init__(message)
        self.kind = kind
