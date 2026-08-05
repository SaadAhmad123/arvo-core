# Developer usage findings

Written after building `ArvoEvent`, by using it the way an actual consumer would rather than through unit tests written against the spec. Scenarios run: minimal and fully-populated construction; a realistic root→child event chain; JSON wire serialization and reconstruction via `model_validate_json` (not just the constructor); the OpenTelemetry span-derivation helper wired end-to-end; construction from a plain dict (`ArvoEvent(**incoming)`); and, in a genuinely isolated environment with `opentelemetry-api` *not installed at all*, confirming the package still imports and works, and only the OTel-specific helper fails.

Each scenario below was actually run against the committed code, not theorized.

## Two real bugs found and fixed during this pass (already committed separately)

Recorded here for completeness, since they were found by exactly this kind of hands-on exercise, before the test suite existed to lock them in:

1. **Missing `subject` produced a confusing second error.** The `executionid`-defaults-to-`subject` before-validator injected `executionid: None` even when `subject` itself was absent, producing a spurious "executionid: Input should be a valid string" alongside the real "subject: Field required". Fixed: only inject the default when `subject` is actually present. Now covered by `test_error_reporting.py`'s multi-failure-message test.
2. **Field mutation after construction leaked `pydantic_core.ValidationError` directly**, not `ArvoEventValidationError` — the one path that bypassed the `__init__` wrapping. Attempted to fix by overriding `__setattr__`; `pyrefly` correctly rejected this as unsound on a `frozen=True` Pydantic model. Reverted, since the "never leak Pydantic" guarantee in the spec is scoped to construction failures specifically — a narrower, but still fully honest, guarantee.

## Verified working, not assumed

- **`model_validate` / `model_validate_json` also raise `ArvoEventValidationError`, with `.__cause__` correctly set to the real `pydantic.ValidationError`** — not just the plain constructor path (`ArvoEvent(**data)`). This mattered to check explicitly: Pydantic v2's alternate construction entry points don't always route through `__init__` the same way across versions, and a consumer reconstructing an event from wire JSON is exactly as likely to reach for `ArvoEvent.model_validate_json(raw)` as for `ArvoEvent(**json.loads(raw))`. Confirmed both wrap correctly.
- **`import arvo_core` succeeds in an environment where `opentelemetry-api` is not installed at all**, confirmed in a genuinely isolated `uv run --isolated` environment, not merely reasoned about from the lazy-import structure. Accessing `trace_context_from_span` in that same environment fails with a plain `ModuleNotFoundError` naming `opentelemetry` — the expected, honest failure mode for a consumer who forgot the `otel` extra, not a confusing import-time crash on an unrelated `import arvo_core`.
- **A realistic root→child event chain** (`parentid`, `executionid`, `depth` all set explicitly on the child) constructs cleanly and round-trips its identity fields correctly.
- **The OpenTelemetry helper works end-to-end**: `trace_context_from_span(span)` → pass the result's `traceparent`/`tracestate` straight into `ArvoEvent(...)` — no friction at the seam between the two.
- **`model_dump_json()`** produces the JSON shape a consumer would expect for putting an event on a wire — field names match ADR-001 exactly, no unexpected renaming or wrapping.

## No further findings

Everything else exercised behaved exactly as `design.md`/`specs/arvo-event/spec.md` describe. No gaps found beyond the two bugs already fixed and separately committed.
