## Why

[ADR-002](../../../docs/adr/002-arvoevent-field-domain-constraints.md) was accepted on 2026-08-03 and partially supersedes [ADR-001](../../../docs/adr/001-arvoevent-structure.md)'s Structural Validity section: it requires `source` and `dataschema` to be RFC 3986 URI-references, restricts every top-level string field to a narrower character domain, and narrows `executionunits` to finite IEEE 754 binary64. The `arvo-event` capability currently implements ADR-001 as it stood before ADR-002, so it permits values ADR-002 now forbids.

This change brings the capability's structural-validity requirements in line with ADR-002. It is scoped to that ADR alone. [ADR-003](../../../docs/adr/003-arvoevent-cloudevent-transformation.md) — the ArvoEvent–CloudEvent transformation that motivated ADR-002 — is separate, later work with its own capability and is out of scope here.

## What Changes

- **BREAKING**: `source` and `dataschema` MUST now be non-empty strings satisfying RFC 3986's URI-reference grammar. A value containing whitespace, an unescaped reserved character outside its syntactic role, or a raw non-ASCII byte sequence, which previously constructed successfully, now fails.
- **BREAKING**: Every top-level string field — `id`, `parentid`, `initid`, `subject`, `executionid`, `category`, `source`, `to`, `domain`, `type`, `dataschema`, `traceparent`, `tracestate` — MUST NOT contain a C0 or C1 control character, `DEL`, a Unicode noncharacter, or an unpaired UTF-16 surrogate, when non-null. This restriction does not extend to string values nested inside `data` or `baggage`.
- **BREAKING**: `traceparent` and `tracestate` are no longer entirely unvalidated. They remain unvalidated for format and content beyond the character-domain restriction above — this is a narrowing of an existing requirement, not a reversal of it.
- `executionunits`, when non-null, MUST be a finite IEEE 754 binary64 value. This is not expected to reject any value a correct implementation could previously construct, since the runtime's own `number` type is already binary64; the requirement documents the domain explicitly rather than changing enforceable behavior.
- **BREAKING**: A supplied `executionunits` of `-0` is now normalized to `0` at construction, so the event never distinguishes them.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `arvo-event`: adds the RFC 3986 URI-reference requirement for `source` and `dataschema`, adds the character-domain restriction across the thirteen top-level string fields, narrows `traceparent`/`tracestate`'s exemption from validation to exclude that same restriction, states `executionunits`' domain as finite binary64 explicitly, and adds negative-zero normalization for `executionunits`.

## Impact

**Affected code**

- `src/ArvoEvent/validator.ts` — new field-level checks for URI-reference syntax and the character-domain restriction; the `executionunits` check gains the negative-zero normalization step
- `src/ArvoEvent/errors.ts` — new diagnostic messages for the two new rule classes, consistent with the existing Diagnostic Quality requirement
- `src/ArvoEvent/index.ts` — constructs the normalized `executionunits` value
- `tests/ArvoEvent/index.spec.ts`, `tests/ArvoEvent/validator.spec.ts` — new cases for both new rules, covering permitted values (hierarchical paths, bare tokens, fragment-only references, absolute URIs; ordinary identifiers) as well as forbidden ones, not only the forbidden ones

**Not touched**

- `src/ArvoEvent/json.ts` and the JSON-value-domain walk for `data`/`baggage` — ADR-002 explicitly does not extend the character-domain restriction to nested payload or ambient-context strings
- `depth` — ADR-002 states explicitly that it needs no new rule; nothing here changes it
- Any CloudEvent-facing code — that is ADR-003's capability, not this one

**Release**: this is the first breaking change to an ADR-001 structural rule since ADR-001 was accepted. ADR-000's stated pre-stability allowance for `arvo-core` v4 is what licenses landing it as a normal change rather than a compatibility-guarded one.

## Out of Scope

Bounded by ADR-002's own scoping:

- Anything ADR-003 defines: the ArvoEvent–CloudEvent transformation, the `data` wrapper, extension-attribute placement, or any encoding of `depth` or `executionunits` for the wire
- Whether any further ArvoEvent field deserves a narrower domain than ADR-001 originally gave it — ADR-002 leaves this deferred, and this change does not settle it in passing
- Contract validation of `data` against `dataschema` — unaffected, still a handler-trust-boundary concern
