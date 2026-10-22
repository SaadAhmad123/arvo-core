## Why

An event is often carried forward with something about it changed: a layer that passes it on records the trace it is now part of, a forwarder re-addresses it, a producer fills in the execution units it measured, a test adjusts one field of a fixture. In each case the event is still the same event, and its identity must not move. Today the only tool is `cloneArvoEvent`, which means "make another event from this one" and documents that a clone sent alongside its source needs a new `id`. This change adds the operation of its own that the package lacks — mutating an event: the same event, with the fields given replaced and every other carried across — and rebuilds cloning on top of it, so the two stop being two implementations of one job.

**It is an advanced capability.** It exists for those building on `arvo-core` — runtimes, mechanisms, frameworks, tooling — where an event must be carried forward by code that sits between its producer and its consumer. An executor or an application that emits events builds them from a contract, and has no reason to reach for it. Changing an event's addressing or payload in passing is exactly what the protocol otherwise checks, so the operation is offered plainly but documented as the tool for that layer, not for everyday use.

No ADR governs this change. It is API shape, which [ADR-004](../../../../../docs/adr/004-multi-language-implementation-governance.md) leaves to each language, and it adds no model-level behaviour: the event it produces satisfies every rule an event already must.

## What Changes

- **A new public pair, `tryMutateArvoEvent` / `mutateArvoEvent`**, in `src/factories/mutateArvoEvent.ts`, beside `createArvoEvent` and `cloneArvoEvent`. Given an event and a mutation, it returns the same event with the fields in the mutation replaced and every other field carried across, identity and time included.
- **The mutation takes the shape `createArvoEvent` takes**: any field of `ArvoEventParam`, with trace context given as a `span` or as the two headers, never both. A field given as `undefined` replaces nothing.
- **The result is typed from the original** unless the mutation replaces `type` or `data`, in which case the replacement's type takes effect.
- **A span with no trace behind it is ignored**, leaving the event's trace headers as they were, so the operation behaves the same whether or not tracing is set up.
- **A new exported type, `ArvoEventMutation`**, and both functions, from `src/index.ts`.
- **`cloneArvoEvent` becomes a thin wrapper over `tryMutateArvoEvent`.** The two did one job twice. Its signature and its guidance to give a clone a new `id` stay; its cast goes. One edge changes: a span carrying no valid trace now leaves the clone's trace headers as its source's instead of writing an all-zero header.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `arvoevent-construction`: adds mutating an event, and the trace context of a mutation, beside cloning; modifies the trace context of a clone for a span carrying no valid trace. The existing requirements for the non-throwing primitive and its throwing companion, and for reporting every failure as an event validation failure, already cover every variant and apply unchanged.

## Impact

- **New code**: `src/factories/mutateArvoEvent.ts`; one small export from `src/ArvoEvent/opentelemetry.ts` (the existing private span-or-context helper) so the mutation can test a span's trace for validity.
- **Changed code**: `src/factories/cloneArvoEvent.ts` is reimplemented over the mutation, losing its cast and its private trace helper; `src/index.ts` gains the new exports.
- **No new dependencies.** No signature changes. The one behaviour change is the invalid-span edge in cloning, above.

## Not in scope

- **Clearing a field to `null` through a mutation.** The mutation follows `createArvoEvent`'s input, which, under the optional-inputs rule, cannot carry `null`. A mutation can replace a value, not remove one. Widening it is a later change, if a caller needs it.
- **Skipping the payload walk for a mutation that leaves `data` and `baggage` alone.** `tryCreateArvoEvent` takes no validation options, so every mutation checks the payload again. Correct, and left as it is until it shows up as a cost.
- **Who calls it.** The runtime that will continue an event's trace with it is a later change, and nothing here decides that runtime's telemetry.
