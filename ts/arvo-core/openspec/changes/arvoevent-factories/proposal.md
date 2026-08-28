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
- **The three contract-aware variants check the payload against the version's own schema**, and what the check produces is what the event carries — so a value the schema declares a default for is present even when the caller omitted it.
- **`.for`, `.by` and `.error` supply `type` and `dataschema`** from the contract, and default `domain` to the contract's own. [ADR-005](../../../../docs/adr/005-arvocontract-structure.md) — *Domain* says the field exists so "events its factories construct can inherit a default without every call site repeating it". Nothing is resolved: a static value is copied, and a caller's own wins.
- **Only one field is ever filled in silently**, and only where nothing could supply it: `subject`, whose omission means this event starts its own execution.
- **New `ArvoEventFactoryError`** — one error for the operation, rather than stretching `ArvoEventValidationError`, whose own documentation states it does not mean a payload failed contract validation.
- **BREAKING**: none. Additive.

### What a caller writes

Illustrative, not normative — the spec governs.

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
// The version supplies type, dataschema and domain. The payload is checked
// against its `accepts`, and its declared defaults come back filled in.
const requested = createArvoEvent.for(orders.versions['1.0.0'], {
  source: 'com.web.checkout',
  subject: 'order-42',
  data: { items: ['book'] },
});
requested.type;           // 'com_order_create'
requested.dataschema;     // '#/com/order/create/1.0.0'
requested.data.currency;  // 'GBP', from the schema's default
```

```ts
// Emitting. `type` is one of the version's emits keys; anything else does not
// compile, and its schema is the one the payload is checked against.
createArvoEvent.by(v1, {
  type: 'com_order_created',
  source: 'com.order.service',
  subject: requested.subject,
  parentid: requested.id,
  data: { order_id: 'o-1' },
});
```

```ts
// The handler error, from the error itself. The payload shape is the
// contract's, so a caller passes the error rather than assembling it.
catch (error) {
  return createArvoEvent.error(v1, {
    source: 'com.order.service',
    subject: requested.subject,
    error: error as Error,
  });
}
```

```ts
// Clone copies every field, `id` and `time` included, then applies overrides.
const routed = createArvoEvent.clone(emitted, { to: 'com.audit.log' });
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

## Failure

One error, `ArvoEventFactoryError`: a `_tag`, a frozen list of `ErrorIssue`s, a message naming every rule that broke, and the event's own `ArvoEventValidationError` as `cause` when the failure came from the constructor.

| Situation | Position |
|---|---|
| the payload does not satisfy the version's schema | `data.…` |
| a field breaks a structural rule of an event | that field |

Two sources, one error, so a caller has one thing to catch or one list to read.

## Capabilities

### New Capabilities
- `arvoevent-construction`: building an ArvoEvent, and building one from a contract that supplies its type, its `dataschema`, its default domain, and the schema its payload is checked against.

### Modified Capabilities

None. `arvo-event` keeps its rules — every event is built by its constructor — and `arvo-contract` keeps its own, a declaration being read and never changed.

## Impact

**Affected code**

- `src/factories/createArvoEvent/` (new) — one file per variant, a shared payload check, and the assembled surface
- `src/factories/errors.ts` (new) — `ArvoEventFactoryError`
- `src/index.ts` — new public exports
- `tests/factories/createArvoEvent/` (new)
- `ts/sandbox/src/playground.ts` — a section exercising all five

**Dependencies**

None added. `zod`'s standalone `safeParse` checks a payload against a version's schema, as the assertion path already does.

**Not touched**

- `src/ArvoEvent/` — construction goes through the existing constructor, so every structural rule already holds and none is restated.
- `src/ArvoContract/` — a contract is read. Its `handlerError` supplies both the event type and the payload shape, so neither is derived here.

**Release**: additive. Nothing published yet.

## Out of Scope

- **Whether and when to send an event.** ADR-005 defers handler protocol. These build what a caller asked for.
- **Deriving causality.** `parentid`, `initid`, `depth` and `subject` are supplied or defaulted exactly as `ArvoEvent` already defines them. Nothing infers a parent from a "current" event, `.clone` included — that is an execution model.
- **Domain resolution.** ADR-005 defers inheritance, overrides and context-dependent routing to the handler-protocol ADR. Copying a contract's static default is not resolution; anything richer stays out.
- **Symbolic stand-in values.** A field is a value or it is absent. Nothing is filled in with a placeholder the caller did not write.
- **Choosing a version.** A contract-aware variant takes a `VersionedArvoContract`, so the caller has already chosen. Ranges, `latest` and resolution stay out, as the sibling change left them.
- **Building from an `ArvoContract`.** The container declares several versions and cannot know which one to build for.
- **Emitting more than one event per call.** One call, one event.
