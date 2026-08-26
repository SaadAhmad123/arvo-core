## Why

A contract declares what a handler accepts and what it may emit. Nothing in the package uses that declaration to answer the question every consumer of it actually has: *given this event, is it mine, and which of my shapes is it?*

Today a caller holding an `ArvoEvent` and an `ArvoContract` has to do that work themselves — split `dataschema` to find the version, index `versions`, decide whether `event.type` is the accepts type or an emit key or the handler error, reach for the right schema, parse the payload against it, and remember to apply the defaults the contract declared. Every one of those steps is derivable from the contract, and every consumer would derive them the same way. Doing it at each call site is how two consumers end up disagreeing about what a contract permits.

[ADR-005](../../../../docs/adr/005-arvocontract-structure.md) governs what a contract *is* and deliberately does not settle handler behaviour. This change does not settle it either — see **Out of Scope** for exactly where the line is drawn and why an exact-version lookup sits on the near side of it.

## What Changes

- **Modified capability**: `arvo-contract` gains event parsing. No new capability — this is a contract answering questions about its own declaration, which is what the capability already covers.
- **`VersionedArvoContract.tryParse` / `.parse`** — checks an event against this one interface and reports which of its three shapes matched: `accepts`, one of `emits`, or the handler error.
- **`ArvoContract.tryParse` / `.parse`** — resolves which version an event belongs to from its `dataschema`, then delegates. It validates nothing itself, so there is one implementation of what "matches" means rather than two that can drift.
- **A parse result carries the version that validated it**, so a caller holding a result does not need the contract to know which interface was in effect.
- **On success the event is rebuilt**, with defaults the contract declared and the sender omitted now present. The contract is the only thing that knows those defaults.
- **BREAKING**: none. Additive methods on two existing classes.

### Precision out follows precision in

One principle decides every signature here: **how much the result tells you is a consequence of how much you told it.** Never wider than the input justifies, never narrower than what is actually known.

That is not a convenience; it is the thing that makes the surface predictable. A method that returned a precise type from a vague question would be asserting something nobody established, and a method that returned a vague type from a precise question would be discarding information the caller supplied.

Three inputs, three outcomes, all the same rule:

| What the caller supplies | What is known | What comes back |
|---|---|---|
| a version and an asserted type | both | typed event, narrowed category, that version |
| a version, no assertion | the version | that version, wide category, plain event |
| a contract, no assertion | the set of versions | the union of declared versions, wide category, plain event |

Note the third row. The container's `version` is the union of the versions it declares, not `ArvoSemanticVersion` — even in the widest case the output tracks what is genuinely known, and the container does know its own version list. Wide is not the same as vague.

**Asking** — no `expectedType`. "What is this?" The contract answers with the version and the category, and hands back a plain `ArvoEvent`. Deliberately not narrowed: without an assertion the contract does not know which of its shapes it matched until runtime, and an unparameterised `ArvoEvent` says so honestly rather than implying a payload type nobody has established.

**Asserting** — "I believe this is `com_order_created`." Available on `VersionedArvoContract` only, because asserting a type requires knowing which version declares it. The contract confirms or contradicts, and the event comes back typed. Naming something the version does not declare is the caller misusing the contract rather than a bad event, so it fails at the position `expectedType` and stops: there is no schema to check the payload against.

`ArvoContract` therefore takes no `expectedType` at all. It cannot: the version is what it is in the middle of working out.

### Two levels, two jobs

`VersionedArvoContract` holds one interface and does the validating. Its result's `version` is its own single version.

`ArvoContract` holds several and routes. An event's `dataschema` is `{uri}/{version}`, so the container splits it, checks the `uri` half is its own, checks the version half is a version it declares, and hands the event to that version contract. Its result's `version` is the union of the versions it declares — the one it matched, typed as narrowly as the container can know.

Those two checks are deliberately separate failures. An event from a different contract entirely is not the same as an event from an undeclared version of this one — reporting them the same way would make a mismatched contract look like a missing version, and send a reader looking in the wrong place.

So the container is for **discovery** and the version contract with an assertion is for **typed access**. A caller who already knows what they are waiting for goes straight to a version; a caller who does not asks the container first.

## The surface, sketched

Illustrative, not normative — the spec governs. Types are indicative; the real ones will be uglier.

```ts
/** Which of a version's three declared shapes an event matched. */
type ArvoContractEventCategory = 'accepts' | 'emits' | 'handlerError';

/**
 * What a parse reports when nothing was asserted.
 *
 * `event` is unparameterised on purpose. The contract knows the version and
 * the category; it does not know the payload type until a caller says which
 * shape they expect.
 */
type ParsedArvoEvent<V extends ArvoSemanticVersion> = {
  readonly version: V;
  readonly category: ArvoContractEventCategory;
  readonly event: ArvoEvent;
};

/**
 * Which category an asserted type belongs to.
 *
 * Asserting the contract's `type` can only mean `accepts`, the handler error
 * type can only mean `handlerError`, and an emit key can only mean `emits`.
 * The caller has already established which; returning the three-way union
 * would hand back less than they supplied.
 */
type CategoryOf<E extends string, T extends string, C> =
  E extends T ? 'accepts'
  : E extends `handler_${T}_error` ? 'handlerError'
  : E extends keyof C['emits'] ? 'emits'
  : never;

/** The payload that goes with an asserted type. */
type PayloadFor<E extends string, T extends string, C> =
  E extends T ? z.infer<C['accepts']>
  : E extends `handler_${T}_error` ? HandlerErrorPayload
  : E extends keyof C['emits'] ? z.infer<C['emits'][E]>
  : never;

/** What a parse reports when a type was asserted, on a single version. */
type AssertedArvoEvent<V extends ArvoSemanticVersion, E extends string, D> = {
  readonly version: V;
  readonly category: CategoryOf<E, T, C>;
  readonly event: ArvoEvent<E, D>;
};
```

```ts
class VersionedArvoContract<T, V, C, …> {
  /** Every type this version may legitimately carry. */
  type ParsableType = T | keyof C['emits'] | `handler_${T}_error`;

  /** Ask: which of my shapes is this? */
  tryParse(event: ArvoEvent): Result<
    ParsedArvoEvent<V>,
    ArvoContractParseError
  >;

  /** Assert: I believe it is this one. */
  tryParse<E extends ParsableType>(
    event: ArvoEvent,
    expectedType: E,
  ): Result<
    AssertedArvoEvent<V, E, PayloadFor<C, E>>,
    ArvoContractParseError
  >;

  parse(event: ArvoEvent): ParsedArvoEvent<V>;
  parse<E extends ParsableType>(
    event: ArvoEvent,
    expectedType: E,
  ): AssertedArvoEvent<V, E, PayloadFor<C, E>>;
}
```

```ts
class ArvoContract<T, M, …> {
  /**
   * Resolve which version this event belongs to, then delegate. No
   * `expectedType`: asserting one needs a version, and finding the version is
   * this method's job.
   */
  tryParse(event: ArvoEvent): Result<
    ParsedArvoEvent<keyof M & ArvoSemanticVersion>,
    ArvoContractParseError
  >;

  parse(event: ArvoEvent): ParsedArvoEvent<keyof M & ArvoSemanticVersion>;
}
```

Two notes on the sketch. `expectedType` is **not** widened with `string` — a union including `string` swallows the literal members and collapses the parameter to `string`, giving an assertion that type-checks against anything and narrows nothing. And `category` narrows on the assert path, since asserting the contract's `type` implies `'accepts'`, an emit key implies `'emits'`, and the handler error type implies `'handlerError'`.

## Proposed usage

```ts
// Asking. Facts, not types: which version, which category, and the event.
const { version, category, event } = contract.parse(incoming);

if (category === 'handlerError') {
  logger.error(`${version} failed`, event.data);
  return;
}
```

```ts
// Asserting, when the caller already knows what it is waiting for. Straight to
// the version — no discovery step needed.
const v1 = contract.versions['1.0.0'];
const { event, category } = v1.parse(incoming, 'com_order_created');

event.data.order_id; // typed
category;            // 'emits' — not the three-way union

// Which is the point of narrowing it. Without it, a caller who already said
// what they expected would still have to write a check that cannot fail:
//   if (category === 'emits') { ... }
```

```ts
// Discovery then typed access. The version must be narrowed to a literal
// first: indexing `versions` with the union gives a union of version
// contracts, which only accepts a type every one of them declares — and you
// cannot assert an emit before knowing which version declares it.
const found = contract.parse(incoming);

if (found.version === '1.1.0' && found.category === 'emits') {
  const { event } = contract.versions['1.1.0'].parse(
    found.event,
    'com_order_created',
  );
  event.data.estimated_delivery; // typed
}
```

```ts
// Reporting failure without exceptions.
const attempt = contract.tryParse(incoming);
if (!attempt.ok) {
  for (const issue of attempt.error.issues) {
    logger.warn(`${issue.path}: ${issue.message}`);
  }
  return;
}
```

```ts
// A version this contract does not declare stops everything: there is no
// interface to check the payload against.
const stale = contract.tryParse(eventFromVersion_2_0_0);
// -> not ok, naming the version and what this contract does declare
```

```ts
// Defaults the contract declared and the sender omitted are present on the
// way out. The parsed event is a new event, not the one supplied.
const { event: filled } = v1.parse(sparse);
filled.data.currency; // 'GBP', from the schema's default
```

## Failure, and how a caller tells them apart

Parsing is one operation, so it has one error: `ArvoContractParseError`, shaped like `ArvoContractValidationError` — a `_tag`, a frozen list of `ErrorIssue`s, and a message built the same way, naming every rule that was evaluated and saying so when the list is partial. The existing two errors keep their existing jobs, declaring a contract and constructing an event; parsing stops borrowing them.

Five things can go wrong, and the `path` on the issue is what tells them apart.

| Situation | Position | Blocking |
|---|---|---|
| `expectedType` names something this version does not declare | `expectedType` | yes — no schema to check against |
| `event.dataschema`'s `uri` part is not this contract's | `event.dataschema` uri part | yes — wrong event for contract entirely |
| `event.dataschema`'s `version` part is not declared here | `event.dataschema` version part | yes — no interface to select |
| `event.type` matches none of the version's shapes | `type` | no |
| `event.data` fails the matched schema | `data.…` | no |

One position names the request the caller made; the other four name the event they supplied. That is the distinction a caller acts on, and it lives in a field rather than in an error class or a sentence. The middle two matter most: one means the caller is holding the wrong contract, the other that they hold the right contract at an interface it does not have — same severity, opposite next action.

The first three stop the run because nothing below them can be evaluated — the same prerequisite shape `arvo-contract`'s declaration validator already uses for `type`. The last two aggregate, so one call reports both a wrong type and a bad payload rather than one at a time.

## Impact

**Affected code**

- `src/ArvoContract/versioned/index.ts` — the validating pair
- `src/ArvoContract/index.ts` — the resolving pair
- `src/ArvoContract/parse.ts` (new) — the shared checking logic both call
- `src/ArvoContract/errors.ts` — `ArvoContractParseError`, alongside the declaration error
- `src/ArvoContract/types.ts` — the result and payload-mapping types
- `src/index.ts` — new public exports
- `tests/ArvoContract/parse.spec.ts` (new), plus additions to the two class specs

**Dependencies**

None added. `zod`'s standalone `safeParse` is used to check a payload against a schema, since a version's `accepts` is a core schema without parse methods of its own.

**Not touched**

- `src/ArvoEvent/` — an event is unchanged by being parsed. A new one is constructed from it, through the existing constructor, so every structural rule still applies.
- `src/serializers/` — parsing has nothing to do with the canonical form.

**Release**: additive. Nothing published yet.

## Out of Scope

- **Version resolution of any kind.** ADR-005 defers "contract resolution and binding," and versions are absolute and isolated — nothing here resolves between them. Asking whether a version key is declared is a map lookup, which is not what that defers. There is also no range concept to rule out: a version key is a bare `MAJOR.MINOR.PATCH` triple, so `^1.2.0` cannot *be* a declared key and a lookup for it misses exactly as `9.9.9` would. `latest`, `oldest` and range matching stay out, and would be a new decision rather than an extension of this one.
- **Deciding which event a handler should emit, and when.** Handler-protocol work, deferred by ADR-005 and untouched here. This change answers what an event *is*, never what to do next.
- **Domain resolution.** `domain` remains the static default value ADR-005 defines. Parsing reads nothing from it.
- **Validating an event against a contract it does not name.** A parse is always against a specific contract, identified by `dataschema`. Discovering which of several contracts an event belongs to is a different question and not asked here.
- **Emitting or constructing events from a contract.** A factory that builds a conformant event is the natural sibling of this and is deliberately separate: this change reads, it does not write.
- **Dereferencing `dataschema` at runtime.** Deferred by ADR-005. The `uri` is compared as a string, never fetched.
