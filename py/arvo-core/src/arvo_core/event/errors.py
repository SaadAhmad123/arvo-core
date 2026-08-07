"""Errors raised by :mod:`arvo_core.event`."""

from __future__ import annotations

from pydantic import ValidationError


def _describe_pydantic_error(error: ValidationError) -> str:
    lines = []
    for issue in error.errors():
        path = ".".join(str(part) for part in issue["loc"]) or "(root)"
        lines.append(f"{path}: {issue['msg']}")
    if len(lines) == 1:
        return f"ArvoEvent is not structurally valid. {lines[0]}"
    joined = "\n".join(f"  - {line}" for line in lines)
    return f"ArvoEvent is not structurally valid ({len(lines)} problems):\n{joined}"


class ArvoEventValidationError(Exception):
    """Raised when an :class:`~arvo_core.event.model.ArvoEvent` cannot be constructed.

    The message names every failing field and the rule it violated. Always
    raised as ``raise ArvoEventValidationError(...) from original_error``, so
    the original error is preserved as ``__cause__`` — callers do not need to
    import or reference ``pydantic`` to handle this error.
    """

    @classmethod
    def from_pydantic(cls, error: ValidationError) -> ArvoEventValidationError:
        """Builds the error's message from a `pydantic.ValidationError`.

        Does not raise or attach ``__cause__`` itself — the caller does that,
        via ``raise ArvoEventValidationError.from_pydantic(e) from e``, so the
        chaining stays visible at the call site rather than hidden here.
        """
        return cls(_describe_pydantic_error(error))
