## Why

This is the first capability in `py/arvo-core` — the Python implementation of the Arvo Application Model has no code yet, only tooling scaffolding. [ADR-001](../../../../docs/adr/001-arvoevent-structure.md) (partially superseded by [ADR-002](../../../../docs/adr/002-arvoevent-field-domain-constraints.md)) defines `ArvoEvent`'s field set, defaults, and structural validity; ADR-000 requires every ArvoEvent to be transformable into a CloudEvent. Nothing downstream — CloudEvent transformation, the wire serializer, contract validation — can exist before this package has a structurally valid, ADR-001/002-conformant `ArvoEvent` of its own.

Per [ADR-004](../../../../docs/adr/004-multi-language-implementation-governance.md)'s Idiomatic Freedom, this is not a port of `ts/arvo-core`'s `ArvoEvent` class, its constructor-based validation, or its `tryX`/`X` convention. It is a fresh, idiomatic-Python answer to the same ADR-001/002 requirements, built on Pydantic v2 rather than hand-rolled validation, since Pydantic already provides most of what TypeScript's `validator.ts` had to build from scratch (construction-time validation, typed defaults, custom field validators).

## What Changes

- New capability `arvo-event`: a Pydantic-based `ArvoEvent` model implementing every field, default, and structural-validity rule ADR-001 (as amended by ADR-002) states — the same eighteen fields, the same required/defaulted/typed rules, the same ADR-002 domain constraints (RFC 3986 URI-reference canonical form for `source`/`dataschema`, the CloudEvents `String` character-domain exclusion, finite binary64 for `executionunits`).
- Includes OpenTelemetry span-derived `traceparent`/`tracestate`, matching `ts/arvo-core`'s own `ArvoEvent/opentelemetry.ts` in scope (same capability there too, not a separate one) — a standalone helper deriving W3C trace-context strings from a `Span`/`SpanContext`, not baked into the model's own constructor. See `design.md` for why the mechanism deliberately diverges from TypeScript's constructor-level `span` parameter.
- Settles, for this package, the two decisions left open in `openspec/project.md`:
  - **Error-handling idiom**: construction raises on invalid input; no `tryX`/`Result`-pair is introduced. See `design.md` for the full reasoning.
  - **Validation library**: Pydantic v2, per your explicit direction. `openspec/project.md`'s "Validation" section is updated by this change to reflect this as decided, not still open.
- Adds Pydantic as this package's first runtime dependency (`dependencies` in `pyproject.toml`, not `dependency-groups.dev` — it is not a dev-only tool, it is load-bearing for every consumer).

## Capabilities

### New Capabilities

- `arvo-event`: the `ArvoEvent` data model and its structural-validity guarantees, as ADR-001/ADR-002 define them.

## Impact

**Affected code**

- `py/arvo-core/src/arvo_core/event/` (new) — the `ArvoEvent` model and its supporting types/errors.
- `py/arvo-core/tests/event/` (new, mirroring `src/arvo_core/event/`).
- `py/arvo-core/pyproject.toml` — adds `pydantic` to `[project.dependencies]`; adds `opentelemetry-api` as an optional dependency (an `otel` extra), matching `ts/arvo-core`'s own peer-dependency treatment of it — not forced on every consumer.
- `py/arvo-core/openspec/project.md` — the "Validation" section's open question is resolved; a new section states the error-handling idiom this change settles.

**Not touched**

- CloudEvent transformation, the serializer, `ArvoContract`, `ArvoEventHandler` — later capabilities, not this one.
- `ts/arvo-core/` — entirely unaffected. This change touches only `py/arvo-core/`.
- Any ADR — this change implements ADR-001/ADR-002/ADR-004 as already accepted; it proposes no new or amended ADR.

## Out of Scope

- JSON serialization/deserialization to a wire string — that is the (not-yet-proposed) Python equivalent of `ts/arvo-core`'s `ArvoEventSerializer` capability, which depends on this one existing first.
- CloudEvent transformation — depends on this capability, proposed separately once this is accepted and implemented.
- Any change to `ArvoEvent`'s field set, defaults, or structural rules as ADR-001/002 state them. This change implements those rules; it does not renegotiate them.
