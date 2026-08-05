## 1. Dependencies and project setup

- [x] 1.1 Add `pydantic` (v2) to `pyproject.toml`'s `[project.dependencies]` (a real runtime dependency, not `dependency-groups.dev`)
- [x] 1.2 Verified `rfc3986` and `hyperlink` against the same test cases `fast-uri` was checked against. `rfc3986` silently accepts `'::::garbage::::'` as canonical (a real gap); `hyperlink` correctly rejects it, matching `fast-uri`'s behavior exactly. Chose `hyperlink`. One narrow residual gap in both libraries (a colon in a schemeless reference's first path segment) is documented in `design.md`, not hand-patched.
- [x] 1.3 (superseded by 1.2's outcome — `hyperlink` is the chosen alternative)

## 2. `ArvoEventValidationError`

- [x] 2.1 `src/arvo_core/event/errors.py` — `ArvoEventValidationError(Exception)`, constructed from a Pydantic `ValidationError` (or a directly-raised structural issue), formatting a human-readable message naming the failing field(s) and the rule violated, always raised via `raise ArvoEventValidationError(...) from original_error` so `.__cause__` is preserved
- [x] 2.2 No `pydantic` import required in any code that only catches and handles `ArvoEventValidationError` — confirm by writing the first test file's imports before implementing the model itself

## 3. `ArvoEvent` model — fields, config, defaults

- [x] 3.1 `src/arvo_core/event/model.py` — `ArvoEvent(BaseModel)` with `model_config = ConfigDict(frozen=True, extra="forbid")`, all eighteen ADR-001 fields with their ADR-001 types and `None`-ability
- [x] 3.2 `id`: `Field(default_factory=lambda: str(uuid4()))`
- [x] 3.3 `time`: `Field(default_factory=...)` producing a `Z`-suffixed RFC 3339 UTC timestamp — not `.isoformat()`'s own `+00:00`-suffixed output; see `design.md`'s wire-fidelity rationale, carried over from `ts/arvo-core`'s own fix
- [x] 3.4 `depth`: `Field(default=0)`, non-negative int
- [x] 3.5 `baggage`: `Field(default_factory=dict)`
- [x] 3.6 `parentid`, `initid`, `category`, `to`, `domain`, `traceparent`, `tracestate`, `executionunits`: default `None`
- [x] 3.7 `executionid`: `@model_validator(mode="before")` injecting `subject`'s value when `executionid` is absent from the raw input, before per-field validation runs

## 4. `ArvoEvent` model — validators

- [x] 4.1 `@field_validator` on `source`/`dataschema`: non-empty, RFC 3986 URI-reference, exact canonical form (reject, do not normalize, a grammatically valid but non-canonical value)
- [x] 4.2 `@field_validator` (or a shared helper applied to each) on every CloudEvents-`String`-domain field (`id`, `type`, `subject`, `traceparent`, `tracestate`, and this package's own Arvo-only string fields): reject control characters, Unicode noncharacters, unpaired UTF-16 surrogates
- [x] 4.3 `@field_validator` on `executionunits`: finite when not `None` (`math.isfinite`)
- [x] 4.4 `@field_validator` on `data`: recursive walk rejecting a non-finite number at any depth
- [x] 4.5 `@field_validator` on `baggage`: flat map — every value a scalar, reject any nested object/array at any depth
- [x] 4.6 `@model_validator(mode="after")` — root event rule: `parentid is None` implies `executionid == subject and depth == 0`
- [x] 4.7 `@model_validator(mode="after")` — completion correlation rule: `category == "io.arvo.complete"` implies `initid is not None`

## 5. OpenTelemetry span-derived trace context

- [x] 5.1 Add `opentelemetry-api` as an optional dependency in `pyproject.toml` (an `otel` extra, e.g. `[project.optional-dependencies] otel = ["opentelemetry-api"]`) — not an unconditional dependency
- [x] 5.2 `src/arvo_core/event/opentelemetry.py` — `ArvoEventTraceContext` (`NamedTuple` or `TypedDict`: `traceparent: str`, `tracestate: str | None`) and `trace_context_from_span(span_or_context: Span | SpanContext) -> ArvoEventTraceContext`, deriving W3C `traceparent` (`00-{trace_id:032x}-{span_id:016x}-{trace_flags:02x}`) and `tracestate` (via the span context's own `trace_state.to_header()`, or `None` if empty) from either a `Span` (call `.get_span_context()` first) or a `SpanContext` directly
- [x] 5.3 Confirm this module only imports `opentelemetry` under `TYPE_CHECKING` or lazily, so importing `arvo_core` itself does not require `opentelemetry-api` to be installed — only calling `trace_context_from_span` does

## 6. Public exports

- [x] 6.1 `src/arvo_core/__init__.py` — export `ArvoEvent` and `ArvoEventValidationError`
- [x] 6.2 `src/arvo_core/event/__init__.py` — re-export from `model.py`/`errors.py` for a clean `from arvo_core.event import ArvoEvent` path, matching the top-level export; `trace_context_from_span`/`ArvoEventTraceContext` exported alongside

## 7. Tests — field set, required inputs, defaults, immutability

- [x] 7.1 Constructing from only required inputs succeeds and yields a well-formed root event
- [x] 7.2 Omitting any one required input raises `ArvoEventValidationError` naming that field
- [x] 7.3 An unrecognized key raises `ArvoEventValidationError` naming it (confirms `extra="forbid"` behaves as required, not just as configured)
- [x] 7.4 Two events constructed without an explicit `id` get distinct `id` values
- [x] 7.5 Default `time` ends in `Z`
- [x] 7.6 Attempting to assign to any field after construction raises

## 8. Tests — domain constraints

- [x] 8.1 `source`/`dataschema`: a canonical URI-reference (bare token, hierarchical path, absolute URI, fragment-only) is accepted unchanged
- [x] 8.2 `source`/`dataschema`: a grammatically valid but non-canonical value (mixed-case scheme, non-canonical percent-encoding, unresolved dot-segment) is rejected, not normalized
- [x] 8.3 `source`/`dataschema`: a malformed value is rejected
- [x] 8.4 A control character, a Unicode noncharacter, and an unpaired surrogate are each rejected in a CloudEvents-`String`-domain field
- [x] 8.5 `executionunits`: a finite value of arbitrary sign/magnitude is accepted; `NaN`/`inf`/`-inf` are each rejected
- [x] 8.6 `data`: a non-finite number nested at depth (inside a list inside a dict, etc.) is rejected, not only at the top level
- [x] 8.7 `baggage`: a nested object or array value is rejected

## 9. Tests — cross-field rules

- [x] 9.1 Root event: default construction satisfies the rule; an explicit `executionid`/`depth` inconsistent with `parentid is None` is rejected
- [x] 9.2 Completion correlation: `category="io.arvo.complete"` with `initid=None` is rejected; with `initid` set, succeeds

## 10. Tests — OpenTelemetry span-derived trace context

- [x] 10.1 `trace_context_from_span` called with a `SpanContext` directly returns a correctly W3C-formatted `traceparent` and the expected `tracestate`
- [x] 10.2 `trace_context_from_span` called with a `Span` (not a bare `SpanContext`) derives from `.get_span_context()` correctly
- [x] 10.3 A `SpanContext` with no trace state yields `tracestate=None`, not an empty string
- [x] 10.4 `traceparent`/`tracestate` supplied directly to `ArvoEvent` (no span involved) are accepted unvalidated in shape, subject only to the character-domain restriction
- [x] 10.5 Neither trace values nor a span supplied: both fields default to `None`

## 11. Tests — error reporting

- [x] 11.1 Every failure case above is asserted as `ArvoEventValidationError`, never a raw `pydantic.ValidationError` escaping to the caller
- [x] 11.2 `.__cause__` is set and is the original Pydantic (or structural) error for at least one representative failure per validator

## 12. Close out

- [ ] 12.1 `uv run ruff check .` and `uv run ruff format --check .` clean
- [ ] 12.2 `uv run pyrefly check` clean
- [ ] 12.3 `uv run pytest --cov --cov-report=term-missing` — full suite green, 100% coverage of `src/arvo_core/event/**`
- [ ] 12.4 `openspec validate arvo-event --strict` passes
- [ ] 12.5 Update `openspec/project.md`: mark the "Error handling" and "Validation" sections as decided (per `design.md`), not open
- [ ] 12.6 A developer-usage pass, matching the discipline `ts/arvo-core` established — actually construct `ArvoEvent`s as a consumer would (valid, invalid, edge cases) before considering this change done, recording findings in a `developer-usage-findings.md`
