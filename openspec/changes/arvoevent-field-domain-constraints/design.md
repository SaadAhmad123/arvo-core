## Context

See `proposal.md` — Why, for motivation, and `specs/arvo-event/spec.md` for the exact obligations this design has to satisfy. The existing validation core (`src/ArvoEvent/validator.ts`, `src/ArvoEvent/errors.ts`) already aggregates field-level failures and reports them with the Diagnostic Quality this ADR's rules must also meet; nothing here replaces that core, only extends it.

## Goals / Non-Goals

**Goals:**

- Both new rule classes — URI-reference syntax and the character-domain restriction — implemented as precise conformance to the cited external grammars (RFC 3986; the code-point ranges ADR-002 spells out), not an approximation of them
- Every rejected value class gets its own test, not a representative sample, matching the bar this package already holds bespoke validation code to
- No change to how `data`/`baggage` are validated — the character-domain restriction is a top-level-field concern only

**Non-Goals:**

- Anything ADR-003 defines (the CloudEvent transformation, extension-attribute placement, wire encodings for `depth`/`executionunits`) — a separate capability
- Revisiting whether any other ArvoEvent field deserves a narrower domain — ADR-002 leaves this deferred and this change does not settle it

## Decisions

### URI-reference validation is a bespoke RFC 3986 grammar check, not the WHATWG `URL` API

The platform's `URL` constructor looks like the obvious tool, but it implements a different specification with different semantics, not RFC 3986 URI-reference:

- It requires a base to resolve a relative reference at all. `new URL('order-service')` throws; `new URL('order-service', 'http://x/')` does not, but only because it silently resolves against the base — success would depend on an arbitrary base having been supplied, not on `order-service` being a valid reference on its own terms.
- The WHATWG URL Standard percent-encodes characters RFC 3986 would consider invalid rather than rejecting them. A `source` containing a raw space could come back from `new URL()` as successfully parsed with the space silently encoded to `%20` — exactly the outcome ADR-002 rules out: a producer's invalid input must fail construction, not be silently rewritten into something else.

Per this repository's dependency-reuse convention, a general-purpose parsing concern should be reused rather than reimplemented — but that convention assumes a candidate library does the same job. `uri-js` and similar packages exist, but at the point of writing they either wrap the same WHATWG semantics or are thin regex wrappers with no clearer conformance story than a grammar-based check written directly against RFC 3986's own ABNF productions (`URI-reference`, `relative-ref`, `absolute-URI`). Given the correctness risk above, this change writes that check directly against the RFC rather than adopting a dependency whose actual conformance to RFC 3986 — as opposed to a same-named but different spec — would itself need auditing.

**Alternative rejected:** `new URL(value, 'http://arvo.internal/')` as a permissive pre-check. Rejected for the silent-rewriting reason above — it would pass a value that should fail, which is worse than rejecting a value that should pass.

### Character-domain checking iterates by code point, not UTF-16 code unit

Detecting an *unpaired* surrogate requires distinguishing a lone surrogate code unit from one half of a valid pair. JavaScript's own string iteration protocol (`for...of`, `Array.from`, spread) already does this correctly: it combines a valid high/low surrogate pair into the single supplementary-plane code point it represents, and — critically — does not silently repair or substitute a lone surrogate; it surfaces it as itself. So one pass over the string's code points (not its UTF-16 code units, and not a manual pairing routine) is suffient to check all three conditions per character: control range, noncharacter range (including each plane's own two noncharacters, which only exist as combined supplementary code points), and lone surrogate.

**Alternative rejected:** iterating `charCodeAt()` by index and hand-rolling surrogate-pair detection. This duplicates logic the language's own iterator already provides correctly, and is exactly the kind of bespoke-on-top-of-bespoke code this package's higher bar for hand-written validation exists to avoid.

### `executionunits`' binary64 requirement adds no new rejection logic

Every JavaScript `number` value is already IEEE 754 binary64 — there is no finite JS number that fails to be binary64. The existing finiteness check (`Number.isFinite`) already enforces everything this rule adds in this runtime; the spec states the domain explicitly (for conformance across a future non-JS implementation) without requiring new validation code here. The only new behavior is normalization, not rejection.

### Negative-zero normalization happens once, at construction

`Object.is(value, -0) ? 0 : value` (or equivalent) runs where other field defaults and derivations already happen, before the frozen event is produced — not as a validation rule, since `-0` is a legal `executionunits` value under both the old and new domain, only no longer distinguishable from `0` afterward.

## Risks / Trade-offs

**A hand-written RFC 3986 grammar check is easy to get subtly wrong in either direction** (rejecting a legal reference, accepting an illegal one) → every syntactic form ADR-002 names by name — hierarchical path, bare token, fragment-only reference, absolute URI — gets its own accepted-case test, alongside the rejected-case tests, per this package's existing convention of testing what an ADR permits and not only what it forbids.

**Noncharacter range boundaries are easy to get off by one, particularly per-plane** (17 planes, two noncharacters each, plus the BMP's contiguous `U+FDD0`–`U+FDEF` block) → each boundary tested individually rather than by a representative sample, matching the higher bar this package already holds bespoke validation code to.

**Existing fixtures and tests may already construct events with a non-URI-reference `source`, a control character, or rely on `traceparent`/`tracestate` accepting arbitrary content** → expected and accepted; this is a deliberate breaking change licensed by ADR-000's pre-stability allowance, not a regression. Auditing and updating existing fixtures is part of the task breakdown, not a design concern.

**Versioning**: no changeset is added by this change. It lands on `v4`, which is not being released imminently — adding one now would misrepresent an imminent release, following the same reasoning the ADR-001 rebuild change already established for this repository. A changeset covering everything merged into `v4` belongs at the point `v4` actually approaches release.
