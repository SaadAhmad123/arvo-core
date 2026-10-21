## Why

A version runs its layers through `runMiddleware`, a function that takes the executor as an argument and calls it from inside the chain. The version's own steps, before parts then the executor then after parts, cannot be read in the version. The executor's timing, its return and the record it left all travel back out through a shared mutable progress object. Holding the chain in one object with a before and an after puts the version's steps back in the version, in order.

## What Changes

- An internal class holds the resolved layers of one execution and runs them as one before and one after, keeping today's rules for each. It implements the layer interface itself, with a fixed identifier.
- The version calls the composite's before, then its own executor, then the composite's after, inside the one function the run clock races.
- The run clock reaches the composite as a standard `AbortSignal`. The version's timer aborts it, and the composite starts no part from then on.
- `runMiddleware`, `ArvoMiddlewareProgress` and `createArvoMiddlewareProgress` are removed. The executor's start time, return time and emission become locals of the version.
- The version builds its layers with one call, to a standalone async factory, `tryCreateArvoComposedMiddleware`, returning an `AsyncResult`. The factory calls `resolveMiddleware`, whose only job is calling every factory once, then the composite's constructor, which now holds every check on the layers. Both fail with one validation error carrying the fault kind, and the version raises the fault.
- Every mark a layer part makes is recorded, including after the run clock fires, and carries a `middleware.aborted` attribute. Today marks after the clock fires are skipped, and the attribute does not exist.
- A refusal of the layers names every bad entry, or else every repeated identifier, where today it names only the first. Its message is built from those issues, so the wording changes.
- Because every factory is now called before any check, a caller can see a different refusal where several entries are wrong. design.md lists the cases. The spec and ADR-016 do not say which refusal wins.

Observable behaviour does not change beyond these. The order, the failure rules, the clock, the metrics and the faults are all exactly as ADR-016 and the current specs state them.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. This is a refactor of how the chain is run, so `.openspec.yaml` sets `skip_specs: true`.

## Impact

- `src/ArvoEventHandler/version/middleware.ts` and `src/ArvoEventHandler/version/index.ts`, plus new internal files for the class, its validation error and its factory.
- `tests/ArvoEventHandler/version/middleware.spec.ts` tests `runMiddleware` directly and is rewritten against the class. `tests/ArvoEventHandler/middleware/clocks.spec.ts` builds a progress object and changes with it. Every other middleware test runs through the public surface and must pass unchanged.
- Nothing exported from `src/index.ts` changes.

## Governing ADR

ADR-016, *Executor middleware*. It fixes what the chain does and leaves how it is run to each implementation. This change stays inside that latitude.

## Not in scope

- Any change to what a layer, a handler or a caller can observe.
- Exposing the composite publicly, or letting a caller supply one.
- Composition of handlers and the runtime, which remain a later change.
