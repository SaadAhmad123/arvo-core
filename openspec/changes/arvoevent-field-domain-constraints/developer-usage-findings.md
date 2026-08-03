# Developer usage findings

Written after implementing the change, by actually constructing events the way a consumer would — a webhook gateway minting order events, with realistic `source`/`dataschema`/`category` values pulled from the kinds of upstream systems that produce messy strings — rather than through the unit tests written against the spec. Each finding is verified against the real, committed code by running it, not theorized.

## Finding 1 — The character-domain rule is far more permissive than "excludes control characters" might suggest, and that's worth saying explicitly somewhere a consumer will see it

```ts
new ArvoEvent({
  ...base,
  type: 'order.created — v2', // real em dash, U+2014
});
```

Succeeds, unchanged. So does any accented character, CJK text, or emoji in `type`, `category`, `to`, `domain`, or any other restricted field. The rule excludes exactly three things — C0/C1 controls, Unicode noncharacters, unpaired surrogates — and nothing else; it is not an ASCII restriction, and it was never meant to be one.

This matters because the *other* new rule, on `source`/`dataschema`, genuinely is ASCII-only (RFC 3986 URI-reference syntax rejects raw non-ASCII bytes). Sitting next to each other in the same PR, it would be easy for a consumer — or a future contributor skimming the diff — to assume both new rules share one restrictiveness level. They don't, and the gap is exactly the fields where it's most likely to surprise someone: `type` and `category` are exactly the fields a domain would want to localize or write in its own language, and neither is affected by the tighter rule at all.

**Not a defect — a documentation opportunity.** Nothing here needs to change. Worth a line in `src/ArvoEvent/types.ts`'s TSDoc for `type`/`category` (or a shared note) stating plainly that these fields accept any Unicode text outside a narrow forbidden set, since a reader encountering `source`'s stricter rule first has a reasonable reason to assume the same limit applies everywhere.

## Finding 2 — The RFC-grammar implementation is correctly permissive in a way a hand-rolled "looks like a URL" check would likely have gotten wrong

```ts
new ArvoEvent({ ...base, dataschema: '@acme/order-contract@1.0.0' });
```

Succeeds. Surprised me — until working through why: `@` is an explicitly legal character in RFC 3986's `segment-nz-nc` and `pchar` productions, so an npm-style scoped-package specifier is a syntactically valid relative reference, purely as a side effect of the grammar, not because anyone designed for that case.

This is a genuine, if accidental, point in favor of `design.md`'s decision to implement the actual ABNF productions rather than a simpler pattern check: a hand-rolled "starts with a scheme or a slash" heuristic — the kind of thing that's tempting to write instead of the real grammar — would plausibly have rejected this, since it doesn't look like a conventional URL. The reverse case confirms the same precision from the other direction:

```ts
new ArvoEvent({ ...base, source: 'C:\\inetpub\\checkout-service' });
// throws: source: must be a valid RFC 3986 URI-reference
```

A Windows filesystem path is correctly rejected, avoiding the well-known class of bug where a naive parser misreads `C:` as a URI scheme and silently accepts garbage after it — backslash is not a valid path character in RFC 3986, and the grammar-based check catches that precisely rather than by accident.

**No action — recorded as validation of a decision already made.** `design.md`'s rejection of a WHATWG-`URL`-based or heuristic check is doing real work; both directions of this finding are exactly what "conformance to RFC 3986 itself, not an approximation of it" was for.

## Finding 3 — A URI-reference rejection doesn't say what's wrong with the string, unlike a character-domain rejection

```ts
new ArvoEvent({ ...base, source: 'Checkout Gateway' });
// throws: source: must be a valid RFC 3986 URI-reference (received "Checkout Gateway")
```

Compare the character-domain message for the same category of mistake:

```ts
new ArvoEvent({ ...base, category: 'legacy\tstatus' });
// throws: category: must not contain U+0009 — control characters, Unicode
// noncharacters, and unpaired surrogates are forbidden (received "legacy\tstatus")
```

The second message tells you exactly which code point is the problem. The first tells you the whole string failed a grammar, full stop — for `'Checkout Gateway'` the space is easy enough to spot by eye, but for a longer or less obviously wrong value, a developer has no pointer to *where* in the string the grammar broke, only that it did.

This isn't an oversight so much as a harder problem than it looks: the character-domain check already walks the string one code point at a time, so naming the offender is free. A single regex match against the full URI-reference grammar doesn't carry that information — getting equivalent precision would mean replacing the regex with an actual incremental parser, a materially bigger piece of work than this change's scope, for a diagnostic improvement rather than a correctness one.

**Recorded, not resolved.** The existing Diagnostic Quality requirement ("a reader can correct the input without consulting the source") is met in the weak sense — the rule name is right there — but not in the strong sense the character-domain check happens to deliver. Worth a decision next time `validator.ts`'s URI-reference check is touched: whether it's worth a cheap heuristic (report the first character outside a "definitely safe" set as a likely culprit, without claiming full precision) or whether "must be a valid RFC 3986 URI-reference" is judged sufficient on its own.

## Finding 4 — `executionunits` normalization is exactly as invisible as it should be

```ts
const before = 12.5;
const after = 12.5;
const event = new ArvoEvent({ ...base, executionunits: before - after - 0 });
// a classic source of -0 in real float arithmetic
event.executionunits;                        // 0
Object.is(event.executionunits, -0);         // false
```

Worked on the first try, with no special handling needed by the caller — which is the entire point. A cost-delta computation that nets to zero through subtraction is a completely ordinary way to end up with `-0` by accident, and ArvoEvent quietly makes it indistinguishable from `0` before anyone downstream can branch on the difference.

A BigInt value from a hypothetical precise-accounting integration is rejected outright rather than coerced, with a message that correctly distinguishes it from an ordinary wrong number:

```ts
new ArvoEvent({ ...base, executionunits: 42n });
// throws: executionunits: must be null or a finite IEEE 754 binary64 number (received 42n (bigint))
```

**No action — confirms working as designed.**

## Finding 5 — An authentic accident, not a staged test, and it's a good sign

While writing this document's own exploration code, I mistyped a control character directly into a string literal — the exact slip a copy-paste from a terminal or a rich-text source produces in practice. It wasn't caught by reading the code; it was caught by running it:

```
ArvoEvent is not structurally valid (2 problems):
  - source: must be a valid RFC 3986 URI-reference (received "Checkout Gateway")
  - type: must not contain U+0007 — control characters, Unicode noncharacters, and unpaired surrogates are forbidden (received "order.created\u0007")
```

Both the unrelated `source` mistake and the accidental `type` mistake were reported together, in one pass, exactly as the existing aggregation behavior promises — this wasn't constructed to demonstrate that, it just happened to.

**No action.** Recorded because unplanned validation is worth more than a deliberately written test case demonstrating the same thing.

## What worked without friction

- Every ordinary, realistic `source`/`dataschema` shape a team would actually reach for — a hostname-style identifier, a hierarchical path, a fragment-only contract reference, a full absolute URL with a query string — constructed without any friction or need to consult the ADR.
- Multi-field, multi-rule error aggregation continues to work correctly with the new rules layered on top of the existing ones, including across a mix of old and new rule violations in the same construction call.
- Every error message, old and new alike, was legible without opening `validator.ts` at any point in this exercise — Finding 3 is about *precision*, not legibility; every message correctly named the field and the rule even where it didn't localize the exact character.
