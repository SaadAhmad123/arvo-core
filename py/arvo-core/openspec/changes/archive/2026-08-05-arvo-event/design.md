## Context

See `proposal.md` for motivation. This design implements [ADR-001](../../../../docs/adr/001-arvoevent-structure.md)'s field set, defaults, and structural-validity rules, as amended by [ADR-002](../../../../docs/adr/002-arvoevent-field-domain-constraints.md)'s domain constraints, and settles this package's own error-handling idiom and validation library along the way, per `openspec/project.md`'s two previously-open decisions.

It is informed by, but does not copy, `ts/arvo-core`'s own `ArvoEvent` — see each decision below for where Python's own tooling changes the shape of the answer, not just its syntax.

## Goals / Non-Goals

**Goals:**

- Every ADR-001/ADR-002 rule enforced at construction time, with no way to obtain a structurally invalid `ArvoEvent`.
- Settle this package's error-handling idiom, generally — not just for this capability — since every later fallible operation in this package follows the same shape.
- Lean on Pydantic v2 for everything it already does natively, so this package's own bespoke code is limited to the handful of rules Pydantic has no native concept of (the ADR-002 URI canonical-form check, the JSON-finite-number walk, the ADR-001 cross-field root/correlation rules).

**Non-Goals:**

- OpenTelemetry span-derived trace context, CloudEvent transformation, wire serialization — see `proposal.md`'s Out of Scope.
- Matching `ts/arvo-core`'s `ArvoEvent` API shape. Only the eighteen fields' names and the behavior ADR-001/002 require are shared; everything else (construction, error type, immutability mechanism) is this package's own idiomatic answer.

## Decisions

### Error-handling idiom: construction raises, no `tryX`/`Result` pair

TypeScript's `tryX`/`X` convention exists because plain JavaScript has no native discriminated-failure type and no strong cultural default for handling errors — a `Result` type is an explicit, deliberate addition to compensate. Python's own default is EAFP (exceptions), and Pydantic itself already raises `pydantic.ValidationError` on invalid construction — fighting that with a bolted-on `Result` type would mean wrapping a mechanism Pydantic already gives for free in a second one, exactly the "two mechanisms doing the same job" `project.md`'s *Dependencies and reuse* convention warns against.

Decision: **`ArvoEvent(...)` raises on invalid input.** There is no `try_arvo_event`/non-raising twin. The raised error is `ArvoEventValidationError` (this package's own type, not `pydantic.ValidationError` directly — see below), always constructed with Python's native exception chaining (`raise ArvoEventValidationError(...) from original_error`), so the original Pydantic error is never discarded, satisfying `project.md`'s *Errors* convention ("every raised error ... preserves the underlying cause") using the language's own mechanism for it rather than a hand-rolled `cause` field.

This settles the general idiom for this package, not just for `ArvoEvent`: **future fallible public operations in `py/arvo-core` raise, not return a `Result`**, unless a later change finds a specific, concrete reason EAFP is wrong for that operation — the same way `ts/arvo-core`'s own `tryX`/`X` convention was a considered default, not an inviolable law.

### `ArvoEventValidationError` wraps `pydantic.ValidationError`; consumers never need to import Pydantic to handle it

Pydantic's own `ValidationError` is detailed and well-formed, but exposing it directly as this package's own public error type would leak an implementation detail: a consumer catching `ArvoEvent`'s validation failures would be coupled to Pydantic's own exception shape, and swapping the validation library later (however unlikely) would be a breaking change to error handling, not just an internal refactor. `ArvoEventValidationError` is a small `Exception` subclass — a human-readable `str(...)`, and the original `pydantic.ValidationError` reachable via the standard `.__cause__` (from `raise ... from ...`), not a bespoke field. `project.md`'s *Errors* convention ("names what failed, the value involved, and the rule violated") is satisfied by formatting Pydantic's own `.errors()` output into that message — Pydantic already collects every failing field with enough detail to do this well; this package does not need to re-derive it.

### The model: Pydantic v2 `BaseModel`, `frozen=True`, `extra="forbid"`, `populate_by_name` not needed (Python fields are already valid Python identifiers)

`ArvoEvent` is a Pydantic `BaseModel`. Two of its `model_config` settings do real, load-bearing work, not just style:

- **`frozen=True`** — the Python-native mechanism for the same guarantee `ts/arvo-core`'s `Object.freeze(this)` provides: an `ArvoEvent`, once constructed, cannot be mutated. Pydantic enforces this itself; no custom `__setattr__` override needed.
- **`extra="forbid"`** — directly satisfies ADR-001's *Field Set* requirement ("exactly eighteen fields and no others") and the *Strict Input Rejection* requirement. This is a case where Pydantic's own native behavior *is* the ADR-required behavior, not an approximation of it — `ts/arvo-core` had to hand-write this check field-by-field; here it is one config flag.

Every field keeps ADR-001's own name (`id`, `parentid`, ..., `executionunits`) as the Pydantic field name directly — no alias layer, since Python identifiers and ADR-001's field names already coincide.

### Defaults that depend on another field's value (`executionid` defaults to `subject`) are computed in a `@model_validator(mode="before")`, not after construction

Pydantic validates field-by-field before any cross-field logic runs, so a default that depends on a sibling field's value (`executionid` defaulting to `subject` when omitted) cannot be expressed as a plain per-field `default_factory` — factories don't see other fields' values. The standard, idiomatic Pydantic v2 answer is a `@model_validator(mode="before")` classmethod operating on the raw input mapping: if `executionid` is absent, inject `subject`'s value into it before Pydantic's own per-field validation runs. This keeps the default's application inside Pydantic's own validation pipeline (so a bad `subject` still fails exactly where you'd expect) rather than mutating a `frozen=True` instance after the fact, which `frozen=True` would reject anyway.

### `time`'s default is `Z`-suffixed UTC, not `+00:00` — a lesson carried over from `ts/arvo-core`, not rediscovered independently

`ts/arvo-core`'s own `createTimestamp()` was originally `+00:00`-suffixed and was found, during that package's own development, to lose wire fidelity: the `cloudevents` npm package's `toJSON()` unconditionally normalizes `time` to `new Date(value).toISOString()` — always `Z`, never `+00:00` — so a `+00:00`-suffixed default silently changed on its first real wire round trip, even though the represented instant was identical. Python's `datetime.now(timezone.utc).isoformat()` defaults to `+00:00`, the same trap. This capability's default-`time` implementation must produce a `Z`-suffixed string directly (`datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"`, or equivalent) rather than using `.isoformat()`'s own output unmodified — decided now, before any CloudEvent-transformation capability exists to discover the same bug the hard way a second time.

### The ADR-002 URI-canonical-form check for `source`/`dataschema`: `hyperlink`, verified empirically, not assumed from documentation

`ts/arvo-core` uses `fast-uri`'s `parse`/`serialize` round-trip specifically because it was empirically verified to canonicalize (not just validate) — critical, since ADR-002 requires *rejecting* a grammatically valid but non-canonical value, not normalizing it. Two Python candidates were run against the same test cases `fast-uri` was checked against (case-folding, percent-encoding normalization, dot-segment resolution, and the specific "garbage input gets mangled into something technically parseable" failure mode that made TS's own attempted fix dangerous):

- **`rfc3986`** — correctly rejects (via round-trip inequality) case, percent-encoding, and dot-segment non-canonicality, and whitespace/control-character/non-ASCII input. But `'::::garbage::::'` parses as valid *and* normalizes to itself unchanged — silently accepted, exactly the failure mode being checked for.
- **`hyperlink`** — passes every case `rfc3986` passes, *and* correctly rejects `'::::garbage::::'` (percent-encodes it, detected via the same round-trip-inequality check), matching `fast-uri`'s exact behavior on that input.

Decision: **`hyperlink`**, not `rfc3986`.

**One residual gap, shared by both libraries, accepted rather than hand-patched:** a schemeless reference whose first path segment itself contains a colon (`'a:b:c'`) parses as valid and normalizes to itself unchanged in both libraries, even though RFC 3986 §3.3 states a relative-path reference's first segment must not contain a colon, specifically to avoid ambiguity with `scheme:` syntax. Neither library enforces this narrow rule. Hand-rolling a supplementary check for this one grammar rule was considered and rejected here: it is a genuinely obscure edge case (a colon-containing first path segment with no scheme), catching it would be new bespoke parsing logic layered on top of a library chosen specifically to avoid hand-rolled URI parsing, and nothing in ADR-002 singles this case out as a concern the way the wholesale malformed-input leniency was. Documented, not silently accepted — the same disposition `ts/arvo-core`'s own Finding 3 (a bare-origin `source` rejection) received, for the same reason: a known, narrow, low-probability gap is better recorded than either ignored or over-engineered around.

### `executionunits`' binary64 requirement is automatically satisfied — Python's `float` has no other width

ADR-002 narrows `executionunits` to finite IEEE 754 binary64 specifically because TypeScript's `number` type has no narrower native alternative to constrain *to*. Python's `float` **is** IEEE 754 double precision (binary64) unconditionally — there is no width-narrowing decision to make here at all. The only check this capability needs is finiteness (`math.isfinite`), via a `@field_validator`, and Pydantic's own `int`/`float` type coercion already rejects non-numeric input for free.

### Bespoke, by necessity, not by default: the JSON-finite-number walk and the string character-domain exclusion

Two ADR-001/002 rules have no Pydantic-native equivalent and no clear existing-library candidate, so they are hand-written `@field_validator`s, consistent with *Dependencies and reuse*'s "bespoke is right when the semantics are genuinely Arvo's" exception:

- **JSON-finite-number walk** (`data`, `baggage`): Python's `float('nan')`/`float('inf')` are valid Python values but not valid JSON numbers, and neither Pydantic nor Python's own `json` module rejects them by default (`json.dumps` happily emits non-standard `NaN`/`Infinity` tokens unless `allow_nan=False` is passed explicitly). A recursive walk rejecting non-finite numbers at any depth in `data`, and confirming `baggage` is a flat scalar-only map, is genuinely this package's own semantic requirement — no general-purpose library validates "is this dict strictly JSON-safe by the strict RFC 8259 definition, recursively" as its own concern.
- **String character-domain exclusion** (control characters, Unicode noncharacters, unpaired UTF-16 surrogates — see ADR-002): a regex-based check, ported in *behavior* from `ts/arvo-core`'s own (already-verified-correct) implementation, applied to every ADR-002-governed string field via `@field_validator`. Python strings can represent an unpaired surrogate (e.g., via `surrogateescape`), so this check is not vacuous the way it might first appear.

### Span-derived trace context: a standalone function, not a constructor parameter — deliberately diverging from `ts/arvo-core`'s own mechanism

`ts/arvo-core`'s `ArvoEvent` constructor accepts `traceparent`/`tracestate` *or* a `span`/`SpanContext`, as a TypeScript discriminated union (`{ traceparent?; tracestate? } | { span? }`), and derives the two header strings internally at construction time. That shape exists to give TypeScript's type checker something to enforce ("these are mutually exclusive") — a real need in a language whose type system is worth leaning on for it.

Baking the same behavior into `ArvoEvent`'s own Pydantic constructor would mean accepting an input that is not one of the eighteen ADR-001 fields, handled via a `@model_validator(mode="before")` that both derives trace headers *and* pops a synthetic key back out before Pydantic's own field validation runs — extra complexity in the one place (`extra="forbid"`) this design deliberately kept simple, to support a convenience Python's own type system doesn't reward the same way TypeScript's does. Instead: **`trace_context_from_span(span_or_context) -> ArvoEventTraceContext`** is a standalone function (`ArvoEventTraceContext` a small `NamedTuple` or `TypedDict` with `traceparent: str` and `tracestate: str | None`), and a caller who has a span writes `ctx = trace_context_from_span(span); ArvoEvent(..., traceparent=ctx.traceparent, tracestate=ctx.tracestate)` — two explicit steps instead of one implicit one. This is a deliberate, Pythonic trade: explicit over implicit (a real Python idiom, not an invented preference), at the cost of one extra line at the call site compared to TypeScript's single-parameter convenience.

`opentelemetry-api` is added as an optional dependency (an extra, e.g. `arvo-core[otel]`), not an unconditional one — mirroring `ts/arvo-core`'s own treatment of `@opentelemetry/api` as a peer dependency rather than a hard one, so a consumer who never touches tracing does not pull it in.

The derivation logic itself (W3C `traceparent` = `00-{trace_id:032x}-{span_id:016x}-{trace_flags:02x}`, `tracestate` via the OpenTelemetry Python SDK's own `TraceState.to_header()`) is ported in *behavior* from `ts/arvo-core`'s already-verified-correct `traceContextFromSpan`, using the Python SDK's own equivalent accessors (`SpanContext.trace_id`/`.span_id`/`.trace_flags`/`.trace_state`, an `int`-based representation in Python versus the OpenTelemetry JS SDK's own hex-string representation — the formatting, not the logic, is what changes).

## Risks / Trade-offs

**Every future fallible operation in this package inherits the raises-not-returns idiom decided here**, on the strength of one capability's reasoning. Accepted: the reasoning (Pydantic already raises; EAFP is Python's own default) is general, not specific to `ArvoEvent`, and revisiting it per-capability would just be re-litigating the same argument repeatedly for no benefit.

**A schemeless, colon-containing first-path-segment reference (`'a:b:c'`) is accepted by `hyperlink` when RFC 3986 §3.3 arguably says it shouldn't be** — accepted, documented above, not hand-patched. Narrow, low-probability, and not the failure mode ADR-002 was written to close.

## Considered Alternatives

**`attrs` + `cattrs`** — considered, not chosen. `attrs` is a mature, well-regarded alternative to Pydantic for structured data, and `cattrs` handles (de)serialization. Rejected because Pydantic's validation-first design (raising with detailed, structured errors on construction) maps more directly onto ADR-001/002's own "structurally invalid by construction" requirement, and its ecosystem dominance (per the tooling research already done for this package) makes it the more broadly legible choice for future contributors.

**Plain `dataclasses` with hand-written `__post_init__` validation** — considered, not chosen. This is closest to what `ts/arvo-core` actually did (a hand-rolled `validator.ts`), and rejecting it is the most direct application of *Dependencies and reuse*: nearly everything a hand-written `__post_init__` would do, Pydantic already does, tested and maintained by someone else.

**Exposing `pydantic.ValidationError` directly instead of wrapping it in `ArvoEventValidationError`** — considered, not chosen. See the wrapping decision above; the cost (one small wrapper class) is low against the benefit (consumers never couple to a specific validation library's own exception shape).

## Open Questions

- Exact `@field_validator` composition and ordering (e.g., whether the URI canonical-form check and the character-domain exclusion run as separate validators on `source`/`dataschema` or one combined validator) — an implementation detail for `tasks.md`, not a design-level decision.
