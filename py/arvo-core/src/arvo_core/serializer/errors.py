"""Errors raised by :mod:`arvo_core.serializer`."""

from __future__ import annotations


class ArvoEventSerializerError(Exception):
    """Raised when converting an `ArvoEvent` to or from a wire string fails.

    Always raised as ``raise ArvoEventSerializerError(...) from
    original_error``, so the original error is preserved as ``__cause__``.
    A `CloudEventTransformationError` from `arvo_core.cloudevent` is never
    wrapped here -- it propagates unchanged, distinguishing this module's
    own boundary work from the underlying transformation.
    """
