## Why

Some of what an executor does belongs to no particular version: reading a flag before deciding whether to run, recording how long the work took, refusing on behalf of a tenant, resolving something every version needs. Today each is copied into every executor that needs it and copied again when it changes.

[ADR-016](../../../../../docs/adr/016-executor-middleware.md) is accepted and settles where such a thing lives: in the executor's seat, as a **layer** with a part that runs before the business code and a part that runs after it. A layer has an executor's powers on the way in, may only observe on the way out, and never authors what the execution emits. This change builds it.

## What Changes

- A new public type, `IArvoEventHandlerMiddleware`: an identifier, an optional `before`, an optional `after`.
- `setupArvoEventHandler` accepts `middleware`, applying to every version. Two declared layers sharing an identifier are a declaration error.
- `ArvoEventHandler.execute` and `tryExecute` accept `middleware` per execution, supplied by whatever runs the handler. A supplied identifier already in use is a fault.
- The order is fixed: supplied layers' `before` parts, then declared layers' `before` parts, then the version's executor; `after` parts in exact reverse.
- A `before` that fails stops everything and decides the outcome as the executor's own failure would. An `after` runs only where the executor returned, sees the emission and cannot alter it, and a failure in it is recorded on the span and discarded.
- Two new members on `ArvoExecutionContext`: `middleware`, read, and `setMiddleware`, write — built fresh per execution, never on the record, each key written once.
- One new fault kind, `middleware_conflict`, non-retryable: a duplicate identifier at execution, or a middleware-data key written twice.
- The run clock covers `before` parts, the executor and `after` parts. Expiry during an `after` leaves the result standing and cuts the remaining `after` parts.
- Each part of each layer is marked on the delivery span by identifier; executor time and layer time are recorded apart. No span is opened per layer.

Nothing existing changes meaning. A handler declaring no layers and an execution supplied none behave exactly as today.

## Capabilities

### New Capabilities
- `event-handler-middleware`: layers around a version's executor — how they are declared and supplied, the order they run in, what each part may do and how it fails, the middleware data they hand inward, and what bounds them.

### Modified Capabilities
- `event-handler`: the execution context gains two members, `middleware` and `setMiddleware`; the fault vocabulary gains `middleware_conflict`; the declaration gains `middleware` and one declaration rule; the run clock's coverage is stated where layers are present.

## Impact

- **Public surface:** `IArvoEventHandlerMiddleware` exported from `src/index.ts`; `middleware` on the setup param and the execute param; `middleware` and `setMiddleware` on `ArvoExecutionContext`; `middleware_conflict` on `ArvoFaultKind`. All additive.
- **`src/ArvoEventHandler`:** `setup.ts`, `index.ts`, `version/index.ts`, `version/types.ts`, `types/execute.ts`, `types/setup.ts`, `context/index.ts`, `fault/types.ts`, `fault/retry-safe.ts` or wherever the verdict table lives, `version/telemetry.ts`; one new type file and one new internal file for running the chain.
- **Tests:** new specs for the new capability; existing handler, context and fault specs extended for the new members and kind. Coverage stays at the package bar.
- **Dependencies:** none added.
- **Out of scope:** anything that runs several handlers or supplies layers to them from outside — a later change. The sandbox is untouched.
