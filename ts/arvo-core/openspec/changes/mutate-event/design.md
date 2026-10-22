## Context

See `proposal.md` for why, and `specs/arvoevent-construction/spec.md` for what a mutation must do.

What exists and shapes the approach:

- **`ArvoEventParam`** is the input an event is built from. Every field is optional except `type`, `data`, `source`, `dataschema` and `subject`; trace context is a `span` or the two headers, never both; under the optional-inputs rule no field accepts `null`.
- **`tryCreateArvoEvent` / `createArvoEvent`** build an event from that input. They generate a `subject` when one is omitted and otherwise hand the input to the `ArvoEvent` constructor, which turns a `span` into the two headers through `traceContextFromSpan`.
- **The validator's defaults** fill only what is missing: `id` and `time` are generated, `executionid` defaults to `subject`, `depth` to `0`, `baggage` to `{}`, and every nullable field — `parentid`, `initid`, `category`, `to`, `domain`, `traceparent`, `tracestate`, `executionunits` — to `null`.
- **`tryCloneArvoEvent`** carries an event's fields into `tryCreateArvoEvent` with one cast, because the event's stored fields include `null`s the input type does not accept.

## Goals / Non-Goals

**Goals:**

- The same event, carried forward, with no field changed but those given.
- No type-cast shortcut, unlike the clone it sits beside.
- The result typed from the original, with `type` and `data` taking a replacement's type where one is given.
- The codebase's own conventions: `createArvoEvent`'s input, a `tryX` / `X` pair, `undefined` meaning "replaces nothing".

**Non-Goals:**

- Clearing a field to `null`, and skipping the payload walk (see `proposal.md` — Not in scope).
- Any change to `createArvoEvent`, or to `cloneArvoEvent`'s signature.

## Decisions

### 1. Built through `tryCreateArvoEvent`

`tryMutateArvoEvent` builds the result with `tryCreateArvoEvent`, so the result is validated by the one path every standalone event takes, and a failure is the same `ArvoEventValidationError` every builder reports. `mutateArvoEvent` unwraps it, as `createArvoEvent` unwraps its primitive.

**Alternative considered:** `ArvoEvent.tryParse`, which takes `unknown` and so accepts the stored fields with their `null`s directly. Rejected: it is the parser for events arriving from elsewhere, and a mutation is building, not parsing.

### 2. Carrying the original without a cast

The event's fields are named one by one, so a change to the event's shape fails at compile time in this file. A field holding a value is carried; a field holding `null` is left out, and the validator gives it back as `null`. Every field that cannot be `null` — `id`, `time`, `subject`, `executionid`, `depth`, `source`, `type`, `data`, `dataschema`, `baggage` — is always carried, so no default ever replaces one of the event's own values. The result is exactly the event, with no cast and no reliance on the input type accepting `null`.

**Alternative considered:** spreading the event and casting, as `tryCloneArvoEvent` does. Rejected by `ts/arvo-core/AGENTS.md`: the types can be made to flow, so no cast is warranted.

### 3. The mutation's shape and its `undefined`s

`ArvoEventMutation<TType, TData>` is `Partial<ArvoEventParam<TType, TData>>`: the same fields, under the same rules, as `createArvoEvent` takes, `span` included. Replacements given as `undefined` are filtered out before the spread, as `tryCloneArvoEvent` already does, so `{ time: undefined }` keeps the event's time rather than reaching the validator as missing and coming back as a new one.

### 4. Trace context

Two cases, matching the spec's precedence:

- **A usable span is given** — one whose context `trace.isSpanContextValid` accepts. Neither of the event's own headers is carried, and the span replaces both, so a span with no trace state leaves the result with none.
- **Otherwise** — no span, or a span that fails the test. Each of the event's own headers is carried, and a header given in the mutation overwrites only itself in the spread. A span that fails the test is dropped from the replacements, so a runtime with no tracing set up, whose started spans have an all-zero context, passes events through unchanged rather than writing an invalid header into them.

The span-or-context test reuses the helper `src/ArvoEvent/opentelemetry.ts` already has privately, exported under a name that says what it returns, so there is one copy of it.

### 5. Typing

```ts
export const tryMutateArvoEvent = <
  T extends string,
  D extends Record<string, any>,
  const TType extends string = T,
  TData extends Record<string, any> = D,
>(event: ArvoEvent<T, D>, mutation: ArvoEventMutation<TType, TData>):
  Result<ArvoEvent<TType, TData>, ArvoEventValidationError>
```

Where the mutation gives no `type` or `data`, there is nothing to infer `TType` or `TData` from, so each falls back to its default, the original's `T` and `D`. Where it gives one, it is inferred from it; `const` keeps a `type` as its literal string rather than widening it to `string`.

### 6. `cloneArvoEvent` becomes a thin wrapper over the mutation

Clone and mutation carry the same fields, take the same input, treat `undefined` the same, and resolve trace context by the same precedence. Two implementations of one job is the two-mechanisms problem `project.md` warns against, so `tryCloneArvoEvent` becomes one line over `tryMutateArvoEvent`, with its own type parameters for both the event's and the result's types: `tryMutateArvoEvent<T, D, T, D>(event, overrides ?? {})`. `cloneArvoEvent` keeps unwrapping `tryCloneArvoEvent`.

What stays: clone's public signature, unchanged, so no caller is broken; its TSDoc, which tells a caller to give a clone sent alongside its source a new `id` — the one thing that makes a clone a clone; and every existing clone test.

What goes: the cast in `tryCloneArvoEvent`, and its private trace-resolution helper.

What changes: one edge. A span whose context carries no valid trace now leaves the clone's trace headers as its source's, where before it wrote an all-zero header into the clone. The spec's trace-context requirement for a clone is modified to say so. A `null` passed by an untyped caller to clear a field still reaches the validator and still clears it, as before.

### 7. Documented as an advanced capability

Both functions and `ArvoEventMutation` say, in the first lines of their TSDoc, that they are for code built on `arvo-core` that carries events between a producer and a consumer — a runtime, a mechanism, a framework, a test harness — and that an event an executor or application emits is built from its contract instead. The TSDoc states the rule, not its history, per `project.md`. They are exported from `src/index.ts` like everything else: the package has no second entry point, and hiding the operation would push the same people back to `cloneArvoEvent`, which is the misuse this change exists to end.

**Alternative considered:** a separate entry point, such as `arvo-core/advanced`. Rejected for now: one exported operation does not justify a second surface to version and document, and nothing else in the package would join it yet.

## Risks / Trade-offs

- **[Application code reaches for it anyway]** → It produces a valid event either way; the protocol still checks whatever a handler receives. The TSDoc points such code to building from the contract.

- **[Clone's behaviour moves to the mutation's for an invalid span]** → The only observable change, stated in the modified requirement and covered by a test. An all-zero `traceparent` was never a useful thing to write.

- **[A mutation can replace `id`]** → That is a mutation like any other, and the result is a valid event; the name and the TSDoc say the operation carries an event forward, and a caller wanting a new event has `cloneArvoEvent`. No rule forbids it, because no rule is needed: replacing `id` is visible at the call site.
- **[The payload is walked on every mutation]** → Correct, and measurable later; the fix, if needed, is to let the create pair accept the existing `skipPayloadValidation` option, not to bypass the create pair here.
- **[`TData` inferred from a replacement payload widens literals]** → `{ count: 1 }` infers `{ count: number }`, as `createArvoEvent` already does. Consistent with the rest of the package.
