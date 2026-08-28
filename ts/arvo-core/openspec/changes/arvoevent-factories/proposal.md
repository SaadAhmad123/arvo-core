## Why

A contract declares what a handler accepts and what it may emit. A caller building one of those events gets nothing from it: they retype the event's `type`, assemble `dataschema` by hand, and hope the payload matches a schema nothing checked. Every one of those answers is already in the declaration.

The sibling change — `arvocontract-event-assertion`, archived — taught a contract to *read* an event. This is the other direction: building one. Same declaration, nothing new stored.

Two of those hand-written values are derived strings a caller has no business retyping. `dataschema` is `{uri}/{version}`, and a typo produces an event no consumer can place against a contract. A handler error's type is `handler_{type}_error`, which the contract already spells.

No ADR governs building an event from a contract. [ADR-001](../../../../docs/adr/001-arvoevent-structure.md) governs what an event *is*, and this adds nothing to it — every event here comes out of `ArvoEvent`'s own constructor. [ADR-005](../../../../docs/adr/005-arvocontract-structure.md) defers handler behaviour, and that line holds: this decides how to build an event, never whether or when to send one.

## What Changes

- **New capability `arvoevent-construction`** — building an event, and building one from a contract that supplies what it knows.
- **Three entry points**, each the `tryX`/`X` pair every fallible operation in this package comes as.

| | builds | reached as |
|---|---|---|
| `createArvoEvent` | an event from the fields it is given | a standalone function |
| `cloneArvoEvent` | an existing event, with fields replaced | a standalone function |
| `createArvoEventFactory` | a factory bound to one version of a contract | a standalone function |

- **The factory holds the version**, so it stops being an argument at every call site. Four things to build on it, each in both forms:

| | builds |
|---|---|
| `createAccepted` | the event that version accepts |
| `createEmitted` | one of the events that version emits |
| `createError` | that version's handler error, from an `Error` |
| — | and `tryCreateAccepted`, `tryCreateEmitted`, `tryCreateError` |

- **The two contract-free builders stand outside the factory.** An event nothing declares, and a copy of an existing event, need no contract — so neither is reached through one, and the factory never appears to check something it cannot.

- **These are utilities.** Each does exactly what its name says and decides nothing on the caller's behalf. What a caller does with the event afterwards is theirs.
- **All three contract-aware variants check the payload against the version's own schema**, the handler error's included, and what the check produces is what the event carries — so a value the schema declares a default for is present even when the caller omitted it.
- **The factory's three supply `type` and `dataschema`** from the version. The caller never writes either, except that `createEmitted` names which emitted `type` it means.
- **`createAccepted` also defaults `to`** — the event it builds is a request, and the handler bound to that contract is who accepts it, so `to` falls back to the contract's `type` when the caller says nothing. `createEmitted` and `createError` default nothing: where an emitted event or an error goes is fully the caller's decision.
- **`domain` takes a value or an instruction.** Omitted means the event has no domain. A string is used as it stands. One of `ArvoDomain`'s symbols is resolved before the event is built — `FROM_EVENT_CONTRACT` reads the contract the factory already holds; `FROM_SELF_CONTRACT` and `FROM_TRIGGERING_EVENT` read sources the caller supplies in the options. The `ArvoDomain` module already ships; this change consumes it.
- **Only one field is ever filled in silently**, and only where nothing could supply it: `subject`, whose omission means this event starts its own execution.
- **No new error type.** A factory does exactly two things — build an event and validate its creation — and both are the event failing to come into being, so every failure is the event's own `ArvoEventValidationError`. Its documentation currently says a payload failing contract validation is a separate check; that sentence is amended by this change, since here the contract's schema is part of what creation means.
- **BREAKING**: none. Additive.

## The developer-facing surface

Illustrative, not normative — the spec governs. These signatures are taken from the implementation, so the generics shown are the ones that compile.

```ts
/** Standalone: an event nothing declares. */
const tryCreateArvoEvent: <T extends string, D extends Record<string, any>>(
  param: PartialExcept<ArvoEventParam<T, D>, 'type' | 'data' | 'source' | 'dataschema'>,
) => Result<ArvoEvent<T, D>, ArvoEventValidationError>;

/** Standalone: an existing event with fields replaced. Its typing survives. */
const tryCloneArvoEvent: <T extends string, D extends Record<string, any>>(
  event: ArvoEvent<T, D>,
  overrides?: Partial<ArvoEventParam<T, D>>,
) => Result<ArvoEvent<T, D>, ArvoEventValidationError>;

/** Standalone: a factory bound to one version. */
const tryCreateArvoEventFactory: <V extends VersionedArvoContract>(
  contract: V,
) => Result<ArvoEventFactory<V>, ArvoContractValidationError>;

/** The version is held, so it is not an argument again. */
class ArvoEventFactory<V extends VersionedArvoContract> {
  readonly contract: V;

  /** The event this version accepts. */
  tryCreateAccepted(
    param: ContractEventParam<V['accepts']>,
    options?: ContractEventOptions,
  ): Result<ArvoEvent<V['type'], z.output<V['accepts']>>, ArvoEventValidationError>;

  /** One this version emits. Its handler error is not among them. */
  tryCreateEmitted<E extends keyof V['emits'] & string>(
    param: { type: E } & ContractEventParam<V['emits'][E]>,
    options?: ContractEventOptions,
  ): Result<ArvoEvent<E, z.output<V['emits'][E]>>, ArvoEventValidationError>;

  /** This version's handler error, from the error itself. */
  tryCreateError(
    param: ErrorEventParam,
    options?: ContractEventOptions,
  ): Result<
    ArvoEvent<V['handlerError']['type'], z.output<V['handlerError']['schema']>>,
    ArvoEventValidationError
  >;
}
```

Every one has a throwing twin of the same signature returning the event
directly — `createArvoEvent`, `cloneArvoEvent`, `createArvoEventFactory`,
`createAccepted`, `createEmitted`, `createError`.

The supporting types, and what each is for:

```ts
/** The event fields a caller passes when the version supplies the rest. */
type ContractEventParam<S extends z.$ZodType> =
  Partial<Omit<ArvoEventParam, 'type' | 'dataschema' | 'data' | 'domain'>> & {
    source: string;
    data: z.input<S>;              // the schema's INPUT side: what may be written
    domain?: ArvoDomainInput;      // a string, or an ArvoDomain symbol
  };

/** For the handler error: the payload is not passed — it is read from `error`. */
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
// Bound once, so the version is not repeated.
const orders = createArvoEventFactory(contract.versions['1.0.0']);

// The version supplies type, dataschema and the recipient. The payload is
// checked against its `accepts`, and its declared defaults come back filled in.
const requested = orders.createAccepted({
  source: 'com.web.checkout',
  subject: 'order-42',
  data: { items: ['book'] },
});
requested.type;           // 'com_order_create'
requested.dataschema;     // '#/com/order/create/1.0.0'
requested.to;             // 'com_order_create' — the handler that accepts it
requested.data.currency;  // 'GBP', from the schema's default
```

```ts
// Emitting. `type` is one of the version's emits keys; anything else does
// not compile, and that key's schema is the one the payload is checked against.
const emitted = orders.createEmitted({
  type: 'com_order_created',
  source: 'com.order.service',
  subject: requested.subject,
  parentid: requested.id,
  data: { order_id: 'o-1' },
});
```

```ts
// The handler error, from the error itself.
catch (caught) {
  return orders.createError({
    source: 'com.order.service',
    subject: requested.subject,
    error: caught as Error,
  });
}
```

```ts
// Domain: absent, literal, or resolved.
orders.createAccepted({ source, data });                                   // no domain
orders.createAccepted({ source, data, domain: 'orders_priority' });        // this one
orders.createAccepted({ source, data, domain: ArvoDomain.FROM_EVENT_CONTRACT });
orders.createEmitted(
  { type: 'com_order_created', source, data, domain: ArvoDomain.FROM_TRIGGERING_EVENT },
  { domainCtx: { triggeringEvent: incoming } },   // the symbol's source
);
```

```ts
// No contract involved: an event nothing declares, and a copy of one.
createArvoEvent({ type, source, dataschema, data });
const routed = cloneArvoEvent(emitted, { to: 'com.audit.log' });
routed.data.order_id;   // still typed — the source event's typing survives
```

```ts
// The reporting forms, for a payload from outside.
const attempt = orders.tryCreateAccepted({ source, data: untrusted });
if (!attempt.ok) attempt.error.issues;   // each naming its position
```

## How it works inside

One file per thing built, each exporting a `buildX` primitive that both forms of its method call. Everything funnels into `tryCreateArvoEvent`, which funnels into `ArvoEvent`'s constructor — so there is exactly one path onto which every structural rule already sits.

```
createAccepted ─┐
createEmitted   ├─► resolve domain ─► check payload ─► tryCreateArvoEvent ─► new ArvoEvent
createError    ─┘
cloneArvoEvent ───► resolve trace context, apply overrides ─► tryCreateArvoEvent ─► ⋯
createArvoEvent ──────────────────────────────────────────────────────────────────► ⋯
```

- **`tryCreateArvoEvent`** hands the constructor everything it was given plus a generated `subject`, converts the constructor's validation throw into the error channel, and rethrows anything unexpected.
- **`checkPayload`** runs zod's standalone `safeParse` — a version's schemas are `zod/v4/core` schemas and carry no methods of their own — and returns the schema's output, which becomes the event's payload. Its issues carry zod's path beneath `data`, zod's message as it stands, and the value found at that position, which zod does not report and is fetched by walking the payload.
- **`domainFor`** resolves the `domain` input through the `ArvoDomain` resolver, with the factory's own contract as the event-contract source and the caller's `options.domainCtx` supplying the other two. A missing source reads as `null`, and `null` becomes omission on the way into the constructor.
- **`createEmitted` guards its schema lookup at runtime.** An undeclared `type` cannot compile, but JavaScript callers exist, and without the guard the missing schema reaches the payload check, which throws — out of a function whose purpose is to report.
- **`createError` checks the payload it built itself.** `error?.name` on something that is not an `Error` yields `undefined`, and the check reports it — the alternative is a `TypeError` thrown from a `tryX`.
- **`tryCreateArvoEventFactory` guards its contract.** Anything that is not a version of a contract is reported rather than surfacing later as a `TypeError` from whichever method was called first.
- **`cloneArvoEvent` resolves trace context itself** rather than leaving it to the constructor's own `span` handling: a replacement `span` first, then a replacement header field by field, then the cloned event's own.

## Failure

One error for building an event: `ArvoEventValidationError`, the event's own, from every builder and both forms. Building an event validates its creation, and each failure below is the event failing to come into being, whichever rule caught it — so a caller has one thing to catch, or one `issues` list to read.

Reaching a factory is the one exception, and not an event failure at all: `tryCreateArvoEventFactory` reports `ArvoContractValidationError`, the contract being what was unusable — position `contract`.

| Situation | Position |
|---|---|
| the payload does not satisfy the version's schema | `data.…` |
| `createEmitted` given a type the version does not declare (reachable from JavaScript) | `type` |
| `createError` given something that is not an `Error` | `data.…`, the fields read as `undefined` |
| a field breaks a structural rule of an event | that field |

## Capabilities

### New Capabilities
- `arvoevent-construction`: building an ArvoEvent, and building one from a contract that supplies its type, its `dataschema`, and the schema its payload is checked against.

### Modified Capabilities

None. `arvo-event` keeps its rules — every event is built by its constructor — and `arvo-contract` keeps its own, a declaration being read and never changed.

## Impact

**Affected code**

- `src/factories/createArvoEvent.ts` (new) — the standalone pair
- `src/factories/cloneArvoEvent.ts` (new) — the standalone clone pair
- `src/factories/ArvoEventFactory/` (new) — `factory.ts` holding the class, `index.ts` holding the pair that reaches one, the `accepted.ts` / `emitted.ts` / `error.ts` primitives, and the shared `payload.ts`, `domain.ts` and `types.ts`
- `src/ArvoEvent/errors.ts` — one TSDoc sentence amended: `ArvoEventValidationError` now also reports a payload failing its contract's schema at construction
- `src/index.ts` — new public exports
- `tests/factories/` (new) — mirroring the four modules above
- `ts/sandbox/src/playground.ts` — a section exercising all five

**Dependencies**

None added. Everything zod goes through `zod/v4/core`, the one entry point a library may depend on.

**Not touched**

- `src/ArvoEvent/` behaviour — construction goes through the existing constructor, so every structural rule already holds and none is restated. Only the error's TSDoc sentence above changes.
- `src/ArvoContract/` — a contract is read. Its `handlerError` supplies both the event type and the payload shape, so neither is derived here.
- `src/ArvoDomain/` — already shipped. This change consumes its symbols and resolver as they stand.

**Release**: additive. Nothing published yet.

## Out of Scope

- **Whether and when to send an event.** ADR-005 defers handler protocol. These build what a caller asked for.
- **Deriving causality.** `parentid`, `initid`, `depth` and `subject` are supplied or defaulted exactly as `ArvoEvent` already defines them. Nothing infers a parent from a "current" event, cloning included — that is an execution model.
- **Domain resolution beyond the shipped symbols.** `ArvoDomain` names four places to read a value from, resolved statically before construction. Inheritance chains, orchestration-context routing, and anything else ADR-005 defers to the handler-protocol ADR stays out.
- **Symbolic stand-ins for any other field.** `domain` takes a symbol because a caller may genuinely hold an instruction rather than a value. `source`, `subject` and `dataschema` take values only — nothing is filled in with a placeholder the caller did not write.
- **Choosing a version.** A contract-aware variant takes a `VersionedArvoContract`, so the caller has already chosen. Ranges, `latest` and resolution stay out, as the sibling change left them.
- **Building from an `ArvoContract`.** The container declares several versions and cannot know which one to build for.
- **Emitting more than one event per call.** One call, one event.
