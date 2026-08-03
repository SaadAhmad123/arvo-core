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

### URI-reference validation delegates to `fast-uri`, round-tripped through `parse`/`serialize` rather than trusting either call alone

The platform's `URL` constructor looks like the obvious tool, but it implements a different specification with different semantics, not RFC 3986 URI-reference:

- It requires a base to resolve a relative reference at all. `new URL('order-service')` throws; `new URL('order-service', 'http://x/')` does not, but only because it silently resolves against the base — success would depend on an arbitrary base having been supplied, not on `order-service` being a valid reference on its own terms.
- The WHATWG URL Standard percent-encodes characters RFC 3986 would consider invalid rather than rejecting them. A `source` containing a raw space could come back from `new URL()` as successfully parsed with the space silently encoded to `%20` — exactly the outcome ADR-002 rules out: a producer's invalid input must fail construction, not be silently rewritten into something else.

`zod` v4's `.url()`/`z.string().url()` was also evaluated and ruled out for the same reason: it's a thin wrapper over the WHATWG `URL` constructor, not an independent RFC 3986 grammar, and inherits both problems above.

`fast-uri` was then evaluated directly (not assumed from its README) by running its `parse`/`serialize` against known-invalid input — a raw space, a raw non-ASCII byte, a Windows-style backslash path. All three came back from `parse()` with `hasError: false`, the invalid bytes silently percent-encoded into the parsed result — the same silent-rewrite failure mode as the WHATWG `URL` API, just from a different library. `fast-uri` alone does not solve this.

What it does provide is a `serialize()` that always canonicalizes its input back to a normal form. Round-tripping — `fastUri.serialize(fastUri.parse(value)) === value` — turns that canonicalizing behavior into a rejection: any value `serialize` had to change to make canonical was not already valid as given, which is exactly the "fail, don't rewrite" contract this rule needs. This was verified empirically against the same invalid inputs above (all correctly mismatch after round-tripping) plus every accepted form ADR-002 names (hierarchical path, bare token, fragment-only reference, absolute URI — all round-trip unchanged).

**Accepted cost of the round-trip technique:** `serialize` canonicalizes as part of producing its output, so a value that is grammatically valid but not already canonical mismatches on round-trip and is rejected, stricter than RFC 3986's grammar alone requires. Verified empirically (not assumed) against `fast-uri`'s actual behavior, this canonicalization spans exactly RFC 3986 §6.2.2's "Syntax-Based Normalization": scheme/host lowercased (`HTTPS://arvo.land/x`), percent-encoded hex digits uppercased (`%2f` → `%2F`), percent-encoded unreserved-character octets decoded (`%41` → `A`), and `.`/`..` path segments resolved (`a/./b/../c`). This is a deliberate, informed trade: depending on a maintained library's validation behavior as it actually behaves, rather than reimplementing and maintaining an equivalent canonical-form check by hand to preserve that last increment of permissiveness. Documented in ADR-002 and `specs/arvo-event/spec.md` as an explicit requirement (not merely a code comment) so it is a committed behavior, not an implementation accident.

`fast-uri`'s serialization also happens to apply RFC 3986 §6.2.3 "Scheme-Based Normalization" (e.g., stripping a scheme's registered default port, so `http://x:80/y` fails round-trip too) — a class of normalization RFC 3986 itself calls optional and scheme-specific, which ADR-002 explicitly does not require. This makes the check narrower than the ADR strictly demands in this one respect, never wider: no value the ADR requires accepted is ever rejected by it. Left as an accepted, documented implementation detail (see ADR-002's Consequences) rather than something to independently re-derive, since doing so would mean reimplementing correct behavior the dependency already provides, to accept a form no known producer relies on.

**Alternatives rejected:** `new URL(value, 'http://arvo.internal/')` as a permissive pre-check, `uri-js` (older, less maintained, same lenient-parser shape as `fast-uri`), and a hand-rolled ABNF-based regex (the original implementation of this change) — superseded once `fast-uri` + round-trip equality was verified to behave correctly, since depending on a maintained library beats maintaining an equivalent grammar by hand.

### Character-domain checking uses native `RegExp` Unicode property escapes, not a hand-rolled code-point walk

The original implementation of this change iterated the string one code point at a time (via `for...of`, which already combines a valid surrogate pair into its one supplementary-plane code point and surfaces a lone surrogate as itself), checking each code point against hand-maintained numeric ranges for the control and noncharacter classes.

That range table is unnecessary: C0/C1 controls and DEL are exactly Unicode's own `General_Category=Cc`, and every noncharacter (the BMP's contiguous `U+FDD0`–`U+FDEF` block, plus each plane's own last two code points) is exactly the binary property `Noncharacter_Code_Point`. Both are expressible directly as `RegExp` Unicode property escapes — `\p{Cc}`, `\p{Noncharacter_Code_Point}` — under the `u` flag, which already matches by code point rather than UTF-16 code unit, so a plain `[\uD800-\uDFFF]` class alongside them only ever matches a surrogate that arrived unpaired; a valid pair is tokenized to its combined code point before the class ever sees it. One regex, `/[\p{Cc}\p{Noncharacter_Code_Point}\uD800-\uDFFF]/u`, replaces the entire manual walk and range table, verified against the same 13 boundary cases (each forbidden class, plus confirmatory non-matches: valid surrogate pairs/emoji, em dash, accented text, CJK).

This is preferred over any external package: it needs zero new dependency, and ties the check to the JS engine's own Unicode Character Database rather than either a hand-maintained table or a third party's.

**Alternative rejected:** iterating `charCodeAt()` by index and hand-rolling surrogate-pair detection — superseded by the property-escape regex for the same reason as above, with the added downside of duplicating pairing logic the language already provides correctly.

### `executionunits`' binary64 requirement adds no new rejection logic

Every JavaScript `number` value is already IEEE 754 binary64 — there is no finite JS number that fails to be binary64. The existing finiteness check (`Number.isFinite`) already enforces everything this rule adds in this runtime; the spec states the domain explicitly (for conformance across a future non-JS implementation) without requiring new validation code here. The only new behavior is normalization, not rejection.

### Negative-zero normalization happens once, at construction

`Object.is(value, -0) ? 0 : value` (or equivalent) runs where other field defaults and derivations already happen, before the frozen event is produced — not as a validation rule, since `-0` is a legal `executionunits` value under both the old and new domain, only no longer distinguishable from `0` afterward.

## Risks / Trade-offs

**The round-trip-equality technique rejects a small, bounded class of grammatically valid input as a side effect of `serialize`'s canonicalization** (case-differing scheme/host, non-canonical percent-encoding, unresolved `.`/`..` path segments — RFC 3986 §6.2.2 in full, not merely the two forms first noticed) → accepted deliberately rather than mitigated: reimplementing the grammar by hand to preserve that last increment of permissiveness would reintroduce exactly the maintenance burden depending on `fast-uri` was meant to remove. Documented as a committed requirement, with its own scenarios, in `specs/arvo-event/spec.md` and in ADR-002 itself, not left as an implementation-only detail — an earlier revision of this change stated the rejected class by example rather than by citing the RFC provision that actually bounds it, which understated how much of RFC 3986 was actually in play until checked empirically.

**`fast-uri`'s serialization also applies RFC 3986 §6.2.3 scheme-based normalization (default-port removal) as a side effect, which ADR-002 does not require** → left as an accepted, narrower-than-necessary gap rather than resolved: it only ever makes the check reject something the ADR doesn't require rejecting, never accept something it requires rejected, so correctness in the direction the ADR actually cares about is unaffected. Re-deriving exact scheme-based normalization independently of the dependency would mean owning a scheme→default-port table with no current producer need for it.

**A library's parser could itself be wrong or change behavior across versions** → mitigated the same way bespoke code would be: every syntactic form ADR-002 names by name — hierarchical path, bare token, fragment-only reference, absolute URI — gets its own accepted-case test, alongside the rejected-case tests, so a regression surfaces as a test failure regardless of whether the cause is this package's code or a dependency update.

**Noncharacter range boundaries are easy to get off by one, particularly per-plane** (17 planes, two noncharacters each, plus the BMP's contiguous `U+FDD0`–`U+FDEF` block) → each boundary tested individually rather than by a representative sample, matching the higher bar this package already holds bespoke validation code to. The native `\p{Noncharacter_Code_Point}` property escape ties this to the JS engine's own Unicode Character Database, but the test suite still verifies it rather than trusting the engine's conformance on faith.

**Existing fixtures and tests may already construct events with a non-URI-reference `source`, a control character, or rely on `traceparent`/`tracestate` accepting arbitrary content** → expected and accepted; this is a deliberate breaking change licensed by ADR-000's pre-stability allowance, not a regression. Auditing and updating existing fixtures is part of the task breakdown, not a design concern.

**Versioning**: no changeset is added by this change. It lands on `v4`, which is not being released imminently — adding one now would misrepresent an imminent release, following the same reasoning the ADR-001 rebuild change already established for this repository. A changeset covering everything merged into `v4` belongs at the point `v4` actually approaches release.
