## Why

A contract declares what a handler accepts and what it may emit. A caller building one of those events gets nothing from it: they retype the event's `type`, assemble `dataschema` by hand, and hope the payload matches a schema nothing checked. Every one of those answers is already in the declaration.

The sibling change — `arvocontract-event-assertion`, archived — taught a contract to *read* an event. This is the other direction: building one. Same declaration, nothing new stored.

Two of those hand-written values are derived strings a caller has no business retyping. `dataschema` is `{uri}/{version}`, and a typo produces an event no consumer can place against a contract. A handler error's type is `handler_{type}_error`, which the contract already spells.

No ADR governs building an event from a contract. [ADR-001](../../../../docs/adr/001-arvoevent-structure.md) governs what an event *is*, and this adds nothing to it — every event here comes out of `ArvoEvent`'s own constructor. [ADR-005](../../../../docs/adr/005-arvocontract-structure.md) defers handler behaviour, and that line holds: this decides how to build an event, never whether or when to send one.

## What Changes

- **New capability `arvoevent-construction`** — building an event, and building one from a contract that supplies what it knows.
- **`tryCreateArvoEvent` / `createArvoEvent`** — the pair every fallible operation in this package comes as, with four variants reached as properties of each.

| | what it builds |
|---|---|
| the function itself | an event from the fields it is given |
| `.clone` | an event with the same field values as an existing one, plus overrides |
| `.for` | the event a version accepts |
| `.by` | one of the events a version emits |
| `.error` | a version's handler error event, from an `Error` |

- **These are utilities.** Each does exactly what its name says and decides nothing on the caller's behalf. What a caller does with the event afterwards is theirs.
- **All three contract-aware variants check the payload against the version's own schema**, the handler error's included, and what the check produces is what the event carries — so a value the schema declares a default for is present even when the caller omitted it.
- **`.for`, `.by` and `.error` supply `type` and `dataschema`** from the contract. The caller never writes either, except that `.by` names which emit `type` it means.
- **`.for` also defaults `to`** — the event it builds is a request, and the handler bound to this contract is who accepts it, so `to` falls back to `contract.type` when the caller says nothing. `.by` and `.error` default nothing: where an emitted event or an error goes is fully the caller's decision.
- **`domain` takes a value or an instruction.** Omitted means the event has no domain. A string is used as it stands. One of `ArvoDomain`'s symbols is resolved before the event is built — `FROM_EVENT_CONTRACT` reads the contract the factory already holds; `FROM_SELF_CONTRACT` and `FROM_TRIGGERING_EVENT` read sources the caller supplies in the options. The `ArvoDomain` module already ships; this change consumes it.
- **Only one field is ever filled in silently**, and only where nothing could supply it: `subject`, whose omission means this event starts its own execution.
- **New `ArvoEventFactoryError`** — one error for the operation, rather than stretching `ArvoEventValidationError`, whose own documentation states it does not mean a payload failed contract validation.
- **BREAKING**: none. Additive.

## The developer-facing surface

Illustrative, not normative — the spec governs. These signatures are taken from the working sketch in `src/factories/createArvoEvent/`, so the generics shown are the ones that compile.

```ts
interface TryCreateArvoEvent {
  /** Fields in, event out. Only `subject` is defaulted. */
  <T extends string, D extends Record<string, any>>(
    param: PartialExcept<ArvoEventParam<T, D>, 'type' | 'data' | 'source' | 'dataschema'>,
  ): Result<ArvoEvent<T, D>, ArvoEventFactoryError>;

  /** The same field values, with overrides applied. Typing survives. */
  clone<T extends string, D extends Record<string, any>>(
    event: ArvoEvent<T, D>,
    overrides?: Partial<ArvoEventParam<T, D>>,
  ): Result<ArvoEvent<T, D>, ArvoEventFactoryError>;

  /** The event this version accepts. */
  for<V extends VersionedArvoContract>(
    contract: V,
    param: ContractEventParam<V['accepts']>,
    options?: ContractEventOptions,
  ): Result<ArvoEvent<V['type'], z.output<V['accepts']>>, ArvoEventFactoryError>;

  /** One of the events this version emits. The handler error is not among them. */
  by<V extends VersionedArvoContract, E extends keyof V['emits'] & string>(
    contract: V,
    param: { type: E } & ContractEventParam<V['emits'][E]>,
    options?: ContractEventOptions,
  ): Result<ArvoEvent<E, z.output<V['emits'][E]>>, ArvoEventFactoryError>;

  /** This version's handler error event, from the error itself. */
  error<V extends VersionedArvoContract>(
    contract: V,
    param: ErrorEventParam,
    options?: ContractEventOptions,
  ): Result<
    ArvoEvent<V['handlerError']['type'], z.output<V['handlerError']['schema']>>,
    ArvoEventFactoryError
  >;
}
```

`createArvoEvent` mirrors it exactly, each signature returning the event directly and throwing the same error.

The supporting types, and what each is for:

```ts
/** The event fields a caller passes when a contract supplies the rest. */
type ContractEventParam<S extends z.$ZodType> =
  Partial<Omit<ArvoEventParam, 'type' | 'dataschema' | 'data' | 'domain'>> & {
    source: string;
    data: z.input<S>;              // the schema's INPUT side: what may be written
    domain?: ArvoDomainInput;      // a string, or an ArvoDomain symbol
  };

/** For `.error`: the payload is not passed — it is read from `error`. */
type ErrorEventParam =
  Partial<Omit<ArvoEventParam, 'type' | 'dataschema' | 'data' | 'domain'>> & {
    source: string;
    error: Error;
    domain?: ArvoDomainInput;
  };

/** Machinery, kept out of the event's own fields. */
type ContractEventOptions = {
  domainCtx?: Pick<ArvoDomainContext, 'selfContract' | 'triggeringEvent'>;
};
```

`data` in is the schema's **input** type and `data` out is its **output** type — they genuinely differ wherever the schema declares a default or a transform, because the checked result is what the event carries.

## Using it

```ts
// Nothing to derive from, so the caller says everything but `subject`.
createArvoEvent({
  type: 'com_order_create',
  source: 'com.web.checkout',
  dataschema: '#/com/order/create/1.0.0',
  data: { items: ['book'] },
});
```

```ts
// The version supplies type and dataschema. The payload is checked against
// its `accepts`, and its declared defaults come back filled in.
const requested = createArvoEvent.for(orders.versions['1.0.0'], {
  source: 'com.web.checkout',
  subject: 'order-42',
  data: { items: ['book'] },
});
requested.type;           // 'com_order_create'
requested.dataschema;     // '#/com/order/create/1.0.0'
requested.to;             // 'com_order_create' — a request is addressed to
                          // the handler that accepts it, unless `to` is passed
requested.data.currency;  // 'GBP', from the schema's default
```

```ts
// Emitting. `type` is one of the version's emits keys; anything else does
// not compile, and that key's schema is the one the payload is checked against.
createArvoEvent.by(v1, {
  type: 'com_order_created',
  source: 'com.order.service',
  subject: requested.subject,
  parentid: requested.id,
  data: { order_id: 'o-1' },
});
```

```ts
// The handler error, from the error itself. Its payload shape and its event
// type are both read off the contract's own handlerError.
catch (error) {
  return createArvoEvent.error(v1, {
    source: 'com.order.service',
    subject: requested.subject,
    error: error as Error,
  });
}
```

```ts
// Domain: absent, literal, or resolved.
createArvoEvent.for(v1, { source, data });                                  // no domain
createArvoEvent.for(v1, { source, data, domain: 'orders_priority' });      // this one
createArvoEvent.for(v1, { source, data, domain: ArvoDomain.FROM_EVENT_CONTRACT });
createArvoEvent.by(
  v1,
  { type: 'com_order_created', source, data, domain: ArvoDomain.FROM_TRIGGERING_EVENT },
  { domainCtx: { triggeringEvent: incoming } },   // the symbol's source
);
```

```ts
// Clone copies every field, `id` and `time` included, then applies overrides.
const routed = createArvoEvent.clone(emitted, { to: 'com.audit.log' });
routed.data.order_id;   // still typed — the source event's types survive
```

```ts
// The non-throwing form, for a payload from outside.
const attempt = tryCreateArvoEvent.for(v1, {
  source: 'com.web.checkout',
  subject: 'order-42',
  data: untrusted,
});
if (!attempt.ok) attempt.error.issues;   // each naming its position
```

## How it works inside

One file per variant, each an explicitly named function, assembled into the two dotted surfaces by `Object.assign` and frozen. Every variant funnels into the same plain builder, and the plain builder funnels into `ArvoEvent`'s constructor — so there is exactly one path onto which every structural rule already sits.

```
.for / .by / .error ─► resolve domain ─► check payload (safeParse) ─► raw ─► new ArvoEvent
.clone ────────────────► translate null to absence, apply overrides ─► raw ─► new ArvoEvent
plain ──────────────────────────────────────────────────────────────► raw ─► new ArvoEvent
```

- **`raw`** hands the constructor everything it was given plus a generated `subject`, converts the constructor's validation throw into the error channel, and rethrows anything unexpected.
- **`checkPayload`** runs zod's standalone `safeParse` — a version's schemas are `zod/v4/core` schemas and carry no methods of their own — and returns `z.output<S>`, which becomes the event's payload. Its issues carry zod's path beneath `data`, zod's message as it stands, and the value found at that position, which zod does not report and is fetched by walking the payload.
- **`domainFor`** resolves the `domain` input through the `ArvoDomain` resolver, with the contract as the event-contract source and the caller's `options.domainCtx` supplying the other two. A missing source reads as `null`, and `null` becomes omission on the way into the constructor.
- **`.by` guards its schema lookup at runtime.** An undeclared `type` cannot compile, but JavaScript callers exist, and without the guard the missing schema reaches `safeParse`, which throws — out of a function whose purpose is to report.
- **`.error` checks the payload it built itself.** `error?.name` on something that is not an `Error` yields `undefined`, and the check reports it — the alternative is a `TypeError` thrown from a `tryX`.

## Failure

One error, `ArvoEventFactoryError`: a `_tag`, a frozen list of `ErrorIssue`s, a message naming every rule that broke, and the event's own `ArvoEventValidationError` as `cause` when the failure came from the constructor. The sketch borrows `ArvoEventValidationError` in the meantime; the implementation replaces that, since that error's own documentation says it does not mean a payload failed contract validation.

| Situation | Position |
|---|---|
| the payload does not satisfy the version's schema | `data.…` |
| `.by` given a type the version does not declare (reachable from JavaScript) | `type` |
| `.error` given something that is not an `Error` | `data.…`, the fields read as `undefined` |
| a field breaks a structural rule of an event | that field |

## Capabilities

### New Capabilities
- `arvoevent-construction`: building an ArvoEvent, and building one from a contract that supplies its type, its `dataschema`, and the schema its payload is checked against.

### Modified Capabilities

None. `arvo-event` keeps its rules — every event is built by its constructor — and `arvo-contract` keeps its own, a declaration being read and never changed.

## Impact

**Affected code**

- `src/factories/createArvoEvent/` — `raw.ts`, `clone.ts`, `for-contract.ts`, `by-contract.ts`, `handler-error.ts`, the shared `payload.ts` and `domain.ts`, `types.ts`, and `index.ts` assembling the surface. The sketch of all nine exists and compiles.
- `src/factories/errors.ts` (new) — `ArvoEventFactoryError`
- `src/index.ts` — new public exports
- `tests/factories/createArvoEvent/` (new)
- `ts/sandbox/src/playground.ts` — a section exercising all five

**Dependencies**

None added. Everything zod goes through `zod/v4/core`, the one entry point a library may depend on.

**Not touched**

- `src/ArvoEvent/` — construction goes through the existing constructor, so every structural rule already holds and none is restated.
- `src/ArvoContract/` — a contract is read. Its `handlerError` supplies both the event type and the payload shape, so neither is derived here.
- `src/ArvoDomain/` — already shipped. This change consumes its symbols and resolver as they stand.

**Release**: additive. Nothing published yet.

## Out of Scope

- **Whether and when to send an event.** ADR-005 defers handler protocol. These build what a caller asked for.
- **Deriving causality.** `parentid`, `initid`, `depth` and `subject` are supplied or defaulted exactly as `ArvoEvent` already defines them. Nothing infers a parent from a "current" event, `.clone` included — that is an execution model.
- **Domain resolution beyond the shipped symbols.** `ArvoDomain` names four places to read a value from, resolved statically before construction. Inheritance chains, orchestration-context routing, and anything else ADR-005 defers to the handler-protocol ADR stays out.
- **Symbolic stand-ins for any other field.** `domain` takes a symbol because a caller may genuinely hold an instruction rather than a value. `source`, `subject` and `dataschema` take values only — nothing is filled in with a placeholder the caller did not write.
- **Choosing a version.** A contract-aware variant takes a `VersionedArvoContract`, so the caller has already chosen. Ranges, `latest` and resolution stay out, as the sibling change left them.
- **Building from an `ArvoContract`.** The container declares several versions and cannot know which one to build for.
- **Emitting more than one event per call.** One call, one event.
