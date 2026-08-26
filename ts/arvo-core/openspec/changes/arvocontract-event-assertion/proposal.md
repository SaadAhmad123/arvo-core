## Why

A contract declares what a handler accepts and what it may emit. Nothing in the package uses that declaration to answer the question every consumer of it actually has: *given this event, is it mine, and which of my shapes is it?*

Today a caller holding an `ArvoEvent` and an `ArvoContract` has to do that work themselves — split `dataschema` to find the version, index `versions`, decide whether `event.type` is the accepts type or an emit key or the handler error, reach for the right schema, and check the payload against it. Every one of those steps is derivable from the contract, and every consumer would derive them the same way. Doing it at each call site is how two consumers end up disagreeing about what a contract permits.

[ADR-005](../../../../docs/adr/005-arvocontract-structure.md) governs what a contract *is* and deliberately does not settle handler behaviour. This change does not settle it either — see **Out of Scope** for exactly where the line is drawn and why an exact-version lookup sits on the near side of it.

### Whose rules these are

No ADR governs checking an event against a contract. [ADR-001](../../../../docs/adr/001-arvoevent-structure.md) explicitly leaves "contract validation of data and the trust boundaries at which it occurs" deferred, and ADR-005 defers handler behaviour. So the rules here are this package's reading of records that exist, not a new model-level commitment: they follow from what ADR-001 and ADR-005 already say a `dataschema` is and what a version declares, and they add nothing a contract does not already state.

That reading is worth naming because part of it is the kind of thing an ADR would eventually own. Which of a version's three shapes an event belongs to, and that `dataschema` identifies a contract as `{uri}/{version}`, are things two languages must agree on for two participants to agree on what one contract means. If the deferred ADR arrives and settles them differently, this spec yields to it — the behaviour is what conformance is judged on, per ADR-004, and an ADR outranks a capability spec. Until then, an implementation is what exists.

## What Changes

- **Modified capability**: `arvo-contract` gains event assertion. No new capability — this is a contract answering questions about its own declaration, which is what the capability already covers.
- **`VersionedArvoContract.tryAssert` / `.assert`** — checks an event against this one interface and reports which of its three scopes matched: `accepts`, one of `emits`, or the handler error.
- **`ArvoContract.tryAssert` / `.assert`** — resolves which version an event belongs to from its `dataschema`, then delegates. It checks that `dataschema` against the versions it declares; what it does not do is re-implement the type-and-payload check, so there is one implementation of what "matches" means rather than two that can drift.
- **Both levels check `dataschema`, each against what it alone knows** — the container against the set of versions it declares, the version against its own single version. A caller reaching straight for `contract.versions['1.0.0']` is checked by the thing best placed to check them.
- **A result carries the version that validated it**, so a caller holding a result does not need the contract to know which interface was in effect.
- **The event is returned as it arrived.** Nothing is rebuilt and nothing is rewritten. What the caller gains is the type that was always true of it, plus the two facts the contract established.
- **BREAKING**: none. Additive methods on two existing classes.

### It asserts, it does not transform

The name is the design. `assert` establishes that something already holds — it does not produce a changed thing. So the event that comes back is, identically, the event that went in: same reference, same fields, same payload. All that changed is what the compiler knows about it.

Naming it `parse` would imply the opposite, and the implication leads somewhere real: rebuilding the event through `ArvoEvent`'s constructor so the defaults a schema declares are materialized. That is a different operation wearing this one's name. It hands back an event quietly unequal to the one received, which traps any caller comparing the two, and it puts the contract in the business of editing events when what the caller did was ask a question.

*Consequence, accepted:* schema defaults are not materialized. A field the sender omitted and the schema defaults is absent on the way out, exactly as it was on the way in, and a handler that wants it filled fills it. Nothing about the event is invented by having asked about it.

### Precision out follows precision in

One principle decides every signature here: **how much the result tells you is a consequence of how much you told it.** Never wider than the input justifies, never narrower than what is actually known.

That is not a convenience; it is the thing that makes the surface predictable. A method that returned a precise type from a vague question would be asserting something nobody established, and a method that returned a vague type from a precise question would be discarding information the caller supplied.

Three inputs, three outcomes, all the same rule:

| What the caller supplies | What is known | What comes back |
|---|---|---|
| a version and an expected type | both | typed event, narrowed scope, that version |
| a version, no expected type | the version | that version, wide scope, plain event |
| a contract, no expected type | the set of versions | the union of declared versions, wide scope, plain event |

Note the third row. The container's `version` is the union of the versions it declares, not `ArvoSemanticVersion` — even in the widest case the output tracks what is genuinely known, and the container does know its own version list. Wide is not the same as vague.

**Asking** — no `expectedType`. "What is this?" The contract answers with the version and the scope, and hands back the event unparameterised. Deliberately not narrowed: without an expected type the contract does not know which of its shapes matched until runtime, and an unparameterised `ArvoEvent` says so honestly rather than implying a payload type nobody has established.

**Asserting a type** — "I believe this is `com_order_created`." Available on `VersionedArvoContract` only, because naming a type requires knowing which version declares it. The contract confirms or contradicts, and the event comes back typed. Naming something the version does not declare is the caller misusing the contract rather than a bad event, so it fails at the position `expectedType` and stops: there is no schema to check the payload against.

`ArvoContract` therefore takes no `expectedType` at all. It cannot: the version is what it is in the middle of working out.

### Two levels, two jobs

An event's `dataschema` is `{uri}/{version}` — exactly that, nothing else is accepted — and both levels read it. What differs is what they compare the version half against.

A contract's `uri` is a value it holds, not one this operation works out. ADR-005 derives it from `type` only when an authoring surface allows it to be omitted, and an explicit `uri` always wins and need bear no relation to `type` — so there is no shape an assertion could rely on beyond the version being the final segment. A `uri` is therefore compared for equality and never looked inside: nothing here reads `#/`, counts segments, or reconstructs a `uri`, and a `uri` that looks wrong is simply a `uri` that does not match.

`VersionedArvoContract` holds one interface. It checks the `uri` half is its contract's and the version half is *its own version*, then does the type-and-payload checking. Its result's `version` is that single version.

`ArvoContract` holds several and routes. It checks the `uri` half is its own and the version half is *one of the versions it declares*, then hands the event to that version contract. Its result's `version` is the union of the versions it declares — the one it matched, typed as narrowly as the container can know.

Neither delegates its `dataschema` check to the other, and that is the point. A caller who already knows the version reaches straight for `contract.versions['1.0.0']`, and if that path trusted the caller's choice, an event stamped `…/1.1.0` would validate against `1.0.0` whenever the payload happened to fit — returning a result that says `version: '1.0.0'` while carrying an event that claims otherwise. [ADR-001](../../../../docs/adr/001-arvoevent-structure.md) is explicit that `type` and `dataschema` together identify a contract and neither suffices alone, so each level checks what it can know.

*Consequence:* routed through the container, the version's own check cannot fail — the version half was found in the map a moment earlier. It fails only when a caller goes to a version directly, which is exactly the case that would otherwise be unguarded.

The `uri` and version halves are deliberately separate failures. An event from a different contract entirely is not the same as an event from an undeclared version of this one — reporting them the same way would make a mismatched contract look like a missing version, and send a reader looking in the wrong place.

So the container is for **discovery** and the version contract with an expected type is for **typed access**. A caller who already knows what they are waiting for goes straight to a version; a caller who does not asks the container first.

## The surface, sketched

Illustrative, not normative — the spec governs. Types are indicative; the real ones will be uglier.

```ts
/** Which of a version's three declared shapes an event matched. */
type ArvoContractEventAssertionScope = 'accepts' | 'emits' | 'handlerError';

/**
 * What an assertion reports when no type was expected.
 *
 * `event` is unparameterised on purpose. The contract knows the version and
 * the scope; it does not know the payload type until a caller says which
 * shape they expect.
 */
type AssertedArvoEvent<V extends ArvoSemanticVersion> = {
  readonly version: V;
  readonly scope: ArvoContractEventAssertionScope;
  readonly event: ArvoEvent;
};

/**
 * Which scope an expected type belongs to.
 *
 * Expecting the contract's `type` can only mean `accepts`, the handler error
 * type can only mean `handlerError`, and an emit key can only mean `emits`.
 * The caller has already established which; returning the three-way union
 * would hand back less than they supplied.
 */
type ScopeOf<E extends string, T extends string, C> =
  E extends T ? 'accepts'
  : E extends `handler_${T}_error` ? 'handlerError'
  : E extends keyof C['emits'] ? 'emits'
  : never;

/**
 * The payload that goes with an expected type.
 *
 * Input types, not output types. The event's `data` is returned as it
 * arrived, so a schema carrying a transform or a coercion would have its
 * output type describe a value that was never produced.
 */
type PayloadFor<E extends string, T extends string, C> =
  E extends T ? z.input<C['accepts']>
  : E extends `handler_${T}_error` ? HandlerErrorPayload
  : E extends keyof C['emits'] ? z.input<C['emits'][E]>
  : never;

/**
 * What an assertion reports when a type was expected, on a single version.
 *
 * The same event, narrower. Nothing was rebuilt to earn the parameters.
 */
type NarrowedAssertedArvoEvent<V extends ArvoSemanticVersion, E extends string, D> = {
  readonly version: V;
  readonly scope: ScopeOf<E, T, C>;
  readonly event: ArvoEvent<E, D>;
};
```

```ts
class VersionedArvoContract<T, V, C, …> {
  /** Every type this version may legitimately carry. */
  type AssertableType = T | keyof C['emits'] | `handler_${T}_error`;

  /** Ask: which of my shapes is this? */
  tryAssert(event: ArvoEvent): Result<
    AssertedArvoEvent<V>,
    ArvoContractAssertionError
  >;

  /** Expect: I believe it is this one. */
  tryAssert<E extends AssertableType>(
    event: ArvoEvent,
    expectedType: E,
  ): Result<
    NarrowedAssertedArvoEvent<V, E, PayloadFor<E, T, C>>,
    ArvoContractAssertionError
  >;

  assert(event: ArvoEvent): AssertedArvoEvent<V>;
  assert<E extends AssertableType>(
    event: ArvoEvent,
    expectedType: E,
  ): NarrowedAssertedArvoEvent<V, E, PayloadFor<E, T, C>>;
}
```

```ts
class ArvoContract<T, M, …> {
  /**
   * Resolve which version this event belongs to, then delegate. No
   * `expectedType`: naming one needs a version, and finding the version is
   * this method's job.
   */
  tryAssert(event: ArvoEvent): Result<
    AssertedArvoEvent<keyof M & ArvoSemanticVersion>,
    ArvoContractAssertionError
  >;

  assert(event: ArvoEvent): AssertedArvoEvent<keyof M & ArvoSemanticVersion>;
}
```

Three notes on the sketch. `expectedType` is **not** widened with `string` — a union including `string` swallows the literal members and collapses the parameter to `string`, giving an expectation that type-checks against anything and narrows nothing. `scope` narrows when a type is expected, since the contract's `type` implies `'accepts'`, an emit key implies `'emits'`, and the handler error type implies `'handlerError'`. And payload types are a schema's *input* side, because the payload returned is the one that arrived.

## Proposed usage

```ts
// Asking. Facts, not types: which version, which scope, and the event.
const { version, scope, event } = contract.assert(incoming);

if (scope === 'handlerError') {
  logger.error(`${version} failed`, event.data);
  return;
}
```

```ts
// Expecting a type, when the caller already knows what it is waiting for.
// Straight to the version — no discovery step needed.
const v1 = contract.versions['1.0.0'];
const { event, scope } = v1.assert(incoming, 'com_order_created');

event.data.order_id; // typed
scope;               // 'emits' — not the three-way union

// Which is the point of narrowing it. Without it, a caller who already said
// what they expected would still have to write a check that cannot fail:
//   if (scope === 'emits') { ... }
```

```ts
// The event is the one that went in. Asserting reads; it does not rewrite.
const asserted = v1.assert(incoming, 'com_order_created');
asserted.event === incoming; // true
```

```ts
// Discovery then typed access. The version must be narrowed to a literal
// first: indexing `versions` with the union gives a union of version
// contracts, which only accepts a type every one of them declares — and you
// cannot name an emit before knowing which version declares it.
const found = contract.assert(incoming);

if (found.version === '1.1.0' && found.scope === 'emits') {
  const { event } = contract.versions['1.1.0'].assert(
    found.event,
    'com_order_created',
  );
  event.data.estimated_delivery; // typed
}
```

```ts
// Reporting failure without exceptions.
const attempt = contract.tryAssert(incoming);
if (attempt.isErr()) {
  for (const issue of attempt.error.issues) {
    logger.warn(`${issue.path}: ${issue.message}`);
  }
  return;
}
```

```ts
// A version this contract does not declare stops everything: there is no
// interface to check the payload against.
const stale = contract.tryAssert(eventFromVersion_2_0_0);
// -> an error naming the version and what this contract does declare
```

## Failure, and how a caller tells them apart

Asserting is one operation, so it has one error: `ArvoContractAssertionError`, shaped like `ArvoContractValidationError` — a `_tag`, a frozen list of `ErrorIssue`s, and a message built the same way, naming every rule that was evaluated and saying so when the list is partial. Its heading says the assertion failed, never that the contract is invalid: a caller expecting a type the version does not declare has a perfectly valid contract and a wrong request. The existing two errors keep their existing jobs, declaring a contract and constructing an event; asserting borrows neither.

Six things can go wrong, and the `path` on the issue is what tells them apart. These strings are the surface a caller writes code against, so they are pinned in the spec rather than left to the implementation.

| Situation | `path` | Blocking |
|---|---|---|
| `expectedType` names something this version does not declare | `expectedType` | yes — no schema to check against |
| `event.dataschema` is not of the form `{uri}/{version}` | `event.dataschema.structure` | yes — there are no halves to attribute anything to |
| the `uri` half is not this contract's | `event.dataschema.uri` | yes — wrong event for contract entirely |
| the version half is not declared here | `event.dataschema.version` | yes — no interface to select |
| `event.type` matches none of the version's shapes | `event.type` | yes — with no shape selected there is nothing to check the payload against |
| `event.data` fails the selected schema | `event.data.…` | no |

The halves are found by splitting at the **last** `/`: the version is the final segment, and everything before it is the `uri`. A `uri` contains slashes of its own, so splitting anywhere else attributes part of it to the version and both halves then fail for the wrong reason.

One position names the request the caller made; the other five name the event they supplied. That is the distinction a caller acts on, and it lives in a field rather than in an error class or a sentence. The middle two matter most: one means the caller is holding the wrong contract, the other that they hold the right contract at an interface it does not have — same severity, opposite next action.

The first five stop the run, each for the same reason: nothing below them can be evaluated. `event.type` is what selects the shape, so an unmatched type leaves no schema to check the payload against — checking a payload against every shape the version declares would produce a list of failures for schemas the event never claimed to satisfy. That is the prerequisite shape `arvo-contract`'s declaration validator already uses for `type`, and it recurs here for the same reason: a value the rules below depend on was not established.

So exactly one row aggregates, and it aggregates within itself. A payload can break several rules at once, and all of them are reported — taken straight from `safeParse`'s result, `path` and message as zod produced them. Nothing here re-implements a check zod already performs, or paraphrases what it said.

## Impact

**Affected code**

- `src/ArvoContract/versioned/index.ts` — the checking pair
- `src/ArvoContract/index.ts` — the routing pair
- `src/ArvoContract/assert.ts` (new) — the shared checking logic both call
- `src/ArvoContract/errors.ts` — `ArvoContractAssertionError`, alongside the declaration error
- `src/ArvoContract/types.ts` — the result and payload-mapping types
- `src/index.ts` — new public exports
- `tests/ArvoContract/assert.spec.ts` (new), plus additions to the two class specs

**Dependencies**

None added. `zod`'s standalone `safeParse` is used to check a payload against a schema, since a version's `accepts` is a core schema without parse methods of its own. Only its verdict and its issues are used; the value it produces is discarded, the event being returned as it arrived.

**Not touched**

- `src/ArvoEvent/` — an event is unchanged by being asserted. The same instance comes back, so there is nothing to construct and no rule to re-check.
- `src/serializers/` — asserting has nothing to do with the canonical form.

**Release**: additive. Nothing published yet.

## Out of Scope

- **Version resolution of any kind.** ADR-005 defers "contract resolution and binding," and versions are absolute and isolated — nothing here resolves between them. Asking whether a version key is declared is a map lookup, which is not what that defers. There is also no range concept to rule out: a version key is a bare `MAJOR.MINOR.PATCH` triple, so `^1.2.0` cannot *be* a declared key and a lookup for it misses exactly as `9.9.9` would. `latest`, `oldest` and range matching stay out, and would be a new decision rather than an extension of this one.
- **Where the check runs, and whether it is trusted.** ADR-001 defers contract validation of data and the trust boundaries at which it occurs. This change provides the check; it does not say a handler must run it, or at which boundary, or what to do when it fails. That stays deferred.
- **Materializing schema defaults.** An assertion returns the event it was given. Filling in what a sender omitted is a transformation, and if it is wanted it is a separate operation with a name that says so.
- **Deciding which event a handler should emit, and when.** Handler-protocol work, deferred by ADR-005 and untouched here. This change answers what an event *is*, never what to do next.
- **Domain resolution.** `domain` remains the static default value ADR-005 defines. Asserting reads nothing from it.
- **Validating an event against a contract it does not name.** An assertion is always against a specific contract, identified by `dataschema`. Discovering which of several contracts an event belongs to is a different question and not asked here.
- **Emitting or constructing events from a contract.** A factory that builds a conformant event is the natural sibling of this and is deliberately separate: this change reads, it does not write.
- **Dereferencing `dataschema` at runtime.** Deferred by ADR-005. The `uri` is compared as a string, never fetched.
