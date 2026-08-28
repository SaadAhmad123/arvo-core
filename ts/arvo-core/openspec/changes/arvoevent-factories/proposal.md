## Why

A contract declares what a handler accepts and what it may emit. A caller building one of those events gets no help from it: they write the `type` by hand, assemble the `dataschema` by hand, and hope the payload matches a schema nothing checked. The contract holds every one of those answers.

The sibling change to this one — `arvocontract-event-assertion`, archived — made a contract able to *read* an event. This makes it able to *hand you one*. Same declaration, the other direction.

Building an event by hand is also where a contract quietly stops being a contract. `dataschema` is `{uri}/{version}` and a typo in it produces an event no consumer can place; `handler_{type}_error` is a derived string a caller has no business retyping. Every one of these is derivable, and every caller would derive it the same way.

No ADR governs constructing an event from a contract. [ADR-001](../../../../docs/adr/001-arvoevent-structure.md) governs what an event *is* and this change adds nothing to it — every event here comes out of `ArvoEvent`'s own constructor. [ADR-005](../../../../docs/adr/005-arvocontract-structure.md) defers handler behaviour, and that line is respected: this decides how to build an event, never when to emit one.

## What Changes

- **New capability `arvoevent-construction`** — building a structurally valid event, optionally from a contract that supplies its type, identifier and payload rules.
- **`tryCreateArvoEvent` / `createArvoEvent`** — the pair every fallible operation in this package comes as. The plain form takes the event's fields; its types follow what was passed.
- **Four variants hang off each**, reached as properties:
  - **`.clone(event, overrides?)`** — an event with some fields replaced.
  - **`.for(contract, param)`** — the event that contract *accepts*. Type and identifier come from the contract.
  - **`.by(contract, param)`** — one of the events that contract *emits*, the handler error excluded.
  - **`.error(contract, param)`** — that contract's handler error event, built from an `Error`.
- **The three contract-aware variants check the payload before building**, so an event that comes back is one the contract would accept. Confirmed by the sibling change's own assertion path, not by inspection.
- **The caller never writes `dataschema`**, and never writes `type` except to pick which emit they mean.
- **A contract-aware variant applies the contract's `domain`** when the caller supplies none. [ADR-005](../../../../docs/adr/005-arvocontract-structure.md) — *Domain* says the field exists so "events its factories construct can inherit a default without every call site repeating it". Nothing resolves it; the static value is copied, or the caller's own wins.
- **BREAKING**: none. Additive.

### The developer-facing surface

Illustrative, not normative — the spec governs.

```ts
/** What a contract already knows, so a caller never supplies it. */
type SuppliedByContract = 'type' | 'dataschema';

/** A handler error's payload, from the error that caused it. */
type ErrorParam = Omit<ArvoEventParam, SuppliedByContract | 'data'> & {
  error: Error;
};

interface CreateArvoEvent {
  /** Fields in, event out. Types follow what was passed. */
  <T extends string, D extends Record<string, any>>(
    param: ArvoEventParam<T, D>,
    options?: ArvoEventValidationOptions,
  ): ArvoEvent<T, D>;

  /** The same event with fields replaced. Typed when nothing is replaced. */
  clone<T extends string, D extends Record<string, any>>(
    event: ArvoEvent<T, D>,
  ): ArvoEvent<T, D>;
  clone(event: ArvoEvent, overrides: Partial<ArvoEventParam>): ArvoEvent;

  /** The event this version accepts. */
  for<T extends string, V extends ArvoSemanticVersion, C>(
    contract: VersionedArvoContract<T, V, C>,
    param: Omit<ArvoEventParam, SuppliedByContract | 'data'> & {
      data: z.input<C['accepts']>;
    },
  ): ArvoEvent<T, z.output<C['accepts']>>;

  /** One of the events this version emits. */
  by<T extends string, V extends ArvoSemanticVersion, C, E extends keyof C['emits'] & string>(
    contract: VersionedArvoContract<T, V, C>,
    type: E,
    param: Omit<ArvoEventParam, SuppliedByContract | 'data'> & {
      data: z.input<C['emits'][E]>;
    },
  ): ArvoEvent<E, z.output<C['emits'][E]>>;

  /** This version's handler error event. */
  error<T extends string, V extends ArvoSemanticVersion, C>(
    contract: VersionedArvoContract<T, V, C>,
    param: ErrorParam,
  ): ArvoEvent<`handler_${T}_error`, HandlerErrorPayload>;
}
```

`tryCreateArvoEvent` mirrors it exactly, each signature returning `Result<…, ArvoEventFactoryError>` instead of the event.

### Using it

```ts
// A contract supplies the type and the identifier. The payload is checked.
const requested = createArvoEvent.for(orders.versions['1.0.0'], {
  source: 'com.web.checkout',
  subject: 'order-42',
  data: { items: ['book'] },       // typed by the contract's accepts
});
requested.type;        // 'com_order_create'
requested.dataschema;  // '#/com/order/create/1.0.0'
```

```ts
// Emitting. The emit key is chosen; its payload type follows.
const emitted = createArvoEvent.by(v1, 'com_order_created', {
  source: 'com.order.service',
  subject: requested.subject,
  parentid: requested.id,
  data: { order_id: 'o-1' },
});
```

```ts
// The handler error, from the error itself.
try {
  await work();
} catch (error) {
  return createArvoEvent.error(v1, {
    source: 'com.order.service',
    subject: requested.subject,
    error: error as Error,
  });
}
```

```ts
// Cloning. Nothing replaced, so the typing survives.
const again = createArvoEvent.clone(emitted);
again.data.order_id;   // still typed

// Something replaced, so it does not.
const routed = createArvoEvent.clone(emitted, { to: 'com.audit.log' });
```

```ts
// The non-throwing form, when the payload comes from outside.
const attempt = tryCreateArvoEvent.for(v1, {
  source: 'com.web.checkout',
  subject: 'order-42',
  data: untrusted,
});
if (!attempt.ok) attempt.error.issues;   // each naming its position
```

## Failure

One error, `ArvoEventFactoryError`, shaped like the package's others: a `_tag`, a frozen list of `ErrorIssue`s, a message naming every rule that broke, and the underlying `ArvoEventValidationError` as `cause` when the failure came from the event's own constructor.

| Situation | Position |
|---|---|
| the payload does not satisfy the contract's schema | `data.…` |
| an emit type the version does not declare | `type` |
| a field breaks a structural rule of an event | that field |

Two sources, one error: a caller writes one `catch`, or reads one `issues` list, whichever form they used.

## Capabilities

### New Capabilities
- `arvoevent-construction`: building a structurally valid ArvoEvent, and building one from a contract that supplies its type, its `dataschema`, and the rules its payload must satisfy.

### Modified Capabilities

None. `arvo-event` keeps its rules and `arvo-contract` keeps its own — every event built here goes through `ArvoEvent`'s constructor, and every payload check reads a declaration without changing what one is.

## Impact

**Affected code**

- `src/factories/createArvoEvent/` (new) — one file per variant, plus the assembled surface
- `src/factories/errors.ts` (new) — `ArvoEventFactoryError`
- `src/index.ts` — new public exports
- `tests/factories/createArvoEvent/` (new)
- `ts/sandbox/src/playground.ts` — a section exercising all five

**Dependencies**

None added. `zod`'s standalone `safeParse` checks a payload against a version's schema, as the assertion path already does.

**Not touched**

- `src/ArvoEvent/` — construction goes through the existing constructor, so every structural rule already holds and none is restated.
- `src/ArvoContract/` — a contract is read, never changed.

**Release**: additive. Nothing published yet.

## Out of Scope

- **When to emit an event, and which one.** ADR-005 defers handler protocol. This builds the event a caller asked for; deciding that they should is theirs.
- **Deriving causality.** `parentid`, `initid`, `subject` and `depth` are supplied or defaulted exactly as `ArvoEvent` already defines. A factory that inferred a parent from a "current" event would be inventing an execution model, which is handler-protocol territory.
- **Choosing a version.** A contract-aware variant takes a `VersionedArvoContract`, so the caller has already chosen. Ranges, `latest` and resolution stay out, as the sibling change left them.
- **Building from an `ArvoContract`.** The container declares several versions and cannot know which to build for. Reach the version first.
- **Emitting more than one event.** One call, one event. A handler emitting several calls several times.
- **`domain` resolution.** ADR-005 defers inheritance chains, overrides and context-dependent routing to the handler-protocol ADR. Copying a contract's static default is not resolution; anything richer stays out.
