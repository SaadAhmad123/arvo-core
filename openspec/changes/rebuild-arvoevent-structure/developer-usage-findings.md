# Developer usage findings

Written after building the change, by using the rebuilt `ArvoEvent` the way an actual consumer would rather than through unit tests written against the spec. The scenario: a three-event order-processing workflow — a root event, a downstream request it causes, and the completion answering that request — built by hand with no factory support, since `src/factory/` is out of scope for this change.

Each finding below is verified against the real, committed code, not theorized. Framed for whoever picks up the propagation change next, and for whoever next edits `specs/arvo-event/spec.md` or ADR-001 itself.

## Finding 1 — Constructing anything but a root event is unassisted and easy to get wrong

Building the downstream request and its completion meant hand-computing, per event: `parentid` (one-hop causation), `executionid` (the emitting execution's own identity for a request, but the *caller's* identity for a completion — two different rules on two adjacent lines of code), and `depth` (increments only when a new execution opens, never on a completion).

Nothing in the package points this out. `new ArvoEvent(...)` accepts a self-consistent set of these four fields and a *different*, also-self-consistent but *wrong* set with equal willingness — the root and correlation constraints only catch violations of the constraint itself, not "did you apply the right rule for this event's role." A developer without ADR-001 open next to their editor will produce structurally valid events that are semantically wrong, and nothing will tell them.

This isn't a defect in this change — `src/factory/` existing and eventually being fixed is exactly the mitigation, and the proposal already scopes propagation as a separate change. It's recorded here because it was the single largest source of friction in actually using the class, and because it sharpens what the propagation change needs to deliver: not just correct field values, but a shape that makes the wrong values hard to reach for. A factory that takes a parent event and computes `parentid`/`depth` from it, hiding these rules entirely, would remove nearly everything in this finding.

## Finding 2 — Baggage divergence between a root and its child is not caught

Constructed a root event with `baggage: { tenantId: 'acme', locale: 'en-US' }`, then a "child" event with `baggage: { tenantId: 'WRONG-TENANT' }`. Accepted without complaint.

ADR-001 requires baggage to be written once, at the root, and copied forward unchanged by everything else — "no two branches can diverge" is stated as a direct consequence of the design. This capability's spec correctly does not enforce that (baggage *equality across events* is a propagation concern, not a structural one — a single event's baggage is valid in isolation regardless of what any other event in the workflow carries), so this is not a gap in `arvo-event`. It is exactly the shape of thing the propagation change needs to close, and it's worth that change explicitly listing "baggage on a non-root event must equal the root's" as a requirement, since it's the kind of rule that's easy to state and easy to forget to implement.

## Finding 3 — A value with its own `toJSON()` is rejected, unlike `JSON.stringify`

```
class Money {
  constructor(public cents: number) {}
  toJSON() { return { cents: this.cents, currency: 'USD' }; }
}
new ArvoEvent({ ..., data: { price: new Money(500) } });
```

Throws: `data.price: is a Money, which has no JSON representation.`

`JSON.stringify` would have called `Money.prototype.toJSON()` and serialized `{ cents: 500, currency: 'USD' }` without complaint — that's precisely how `Date` serializes, and it's a standard, common pattern for value objects in TypeScript codebases (money types, branded IDs, custom date wrappers).

This is a real, deliberate consequence of an already-recorded decision (`json.ts`'s `isPlainObject` check, and the design note that `Date`/`Map`/`Set` are rejected rather than silently coerced), not an oversight in the walker — but the decision was made about *native* types with implicit `toJSON` behavior a caller didn't ask for, not about a caller's own class with an *explicit*, intentional `toJSON`. Those are different cases: rejecting a `Date` prevents an implicit, surprising coercion; rejecting a user's own `toJSON` overrides an explicit choice the caller made about how their value serializes.

Neither `specs/arvo-event/spec.md` nor ADR-001 addresses `toJSON` at all — "Payload Structure" only defines membership in the JSON value domain by shape, with no mention of serialization protocols. This is a genuine spec gap, not just an implementation detail, and it needs a decision:

- **Keep rejecting**, and state explicitly that `toJSON` is not honored — a payload's shape must already be JSON, full stop, no implicit conversion of any kind. Simplest, and consistent with the existing `Date`/`Map`/`Set` decision.
- **Call `toJSON()` when present**, before classifying a value, matching `JSON.stringify`'s actual behavior and the common-case expectation. Changes the walker's classification order and needs its own test coverage (a class whose `toJSON()` itself returns something invalid, a `toJSON` that throws, `toJSON` on an array element).

No recommendation implied by leaving this unresolved — this is a decision for whoever owns the spec, not a bug for whoever owns the code.

**Resolved.** The second option was chosen: `walk()` in `json.ts` now calls a value's `toJSON` — own or inherited through its prototype chain, checked the same way `JSON.stringify` checks it — before falling through to rejection, and walks the return value in the original value's place, at the same path. `Date` is now accepted as a direct consequence, not a special case; `Map`/`Set`/a plain class instance without `toJSON` are still rejected exactly as before. A `toJSON()` that throws is reported as a validation issue rather than an uncaught exception; a `toJSON()` that returns something still outside the JSON domain is rejected at the same path the original value occupied.

One subtlety the fix had to account for that this finding didn't originally raise: a `toJSON()` whose return value transitively references the original object again (`toJSON() { return { self: this } }`) needed the same cycle guard as an ordinary object cycle, or it would recurse forever calling `toJSON()` on the same instance without ever revisiting a tracked ancestor. Handled by adding the value to the walk's `ancestors` set before invoking `toJSON` and removing it after, exactly as the existing array and plain-object branches already did — verified with a dedicated test.

Recorded in `design.md` ("A value with its own `toJSON()` is honoured, not rejected") and `specs/arvo-event/spec.md` ("Custom Serialization via `toJSON`"), with test coverage for every case named above.

## Finding 4 — `dataschema` is documented as a URI but only checked for non-emptiness

`dataschema: 'this is not a uri at all !! 123'` is accepted.

ADR-001 describes the field as "the exact contract URI and version this event relates to." `source`, by contrast, has explicit ADR text stating its format is unconstrained ("Its format is unconstrained, so what it establishes is only as strong as the convention a deployment adopts"). `dataschema` has no equivalent statement either way — it's plausible the ADR intends the same latitude, or plausible it was simply not addressed. `specs/arvo-event/spec.md` inherited the ambiguity: "Non-Empty String Fields" requires non-emptiness and says nothing about shape.

Worth a clarifying line in ADR-001 (or its next revision) settling whether `dataschema` needs to parse as a URI, and if so, by which grammar (RFC 3986 is the obvious candidate, but even that has a permissive local-identifier reading). Until settled, this capability correctly implements the more permissive reading, since inventing a stricter rule the ADR didn't state would be settling a deferred decision in passing — exactly what `openspec/project.md`'s governance rules warn against.

## Finding 5 — A TypeScript-optional property and a genuinely absent key look the same in types, not in the payload

```
interface Payload { note?: string; orderId: string }
new ArvoEvent<'t', Payload>({ ..., data: { orderId: '1' } }); // note omitted
```

`'note' in event.data` is `false`. TypeScript's own type for `note` is `string | undefined` — a shape that, in ordinary TypeScript, is equally satisfied by the key being *present* with value `undefined` or *absent* entirely, and most code written against `note?: string` doesn't distinguish the two. The undefined-handling decision (D8 in `design.md`) is correct and deliberate — it exists specifically so payloads built from optional properties construct without friction — but it also means `'key' in data` and `data.key === undefined` are no longer interchangeable the way they usually are for an ordinary object literal a TypeScript developer just wrote by hand.

Not a defect — this is exactly what D8 was for, verified working as designed. Recorded because it's a real, previously-undocumented edge of that decision's actual shape: `design.md` states *that* undefined is treated as absent, but doesn't mention this specific downstream consequence for a caller doing an existence check rather than an equality check. Worth a line in `design.md` or the TSDoc on `data` if this surprises someone in practice.

## What worked without friction

- The full round-trip — `new ArvoEvent(...)` → `JSON.stringify` → `JSON.parse` → `ArvoEvent.safeParse` — produced an equivalent event with zero surprises, which is the property the whole structural-validity design exists to guarantee.
- Every structural rule (root constraint, correlation constraint, non-finite rejection, strictness) behaved exactly as specified when exercised in a realistic sequence rather than in isolation.
- Error messages were legible without consulting the source at every point they were hit during this exercise, including the `Money` rejection above — no message required opening `json.ts` to understand.
