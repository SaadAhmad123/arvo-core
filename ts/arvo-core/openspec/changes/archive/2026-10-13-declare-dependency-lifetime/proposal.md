## Why

[ADR-006](../../../../docs/adr/006-arvoeventhandler-protocol.md), **Dependencies**, opens by naming ADR-000's one constraint on an implementation dependency — no live dependency may be relied upon to survive a suspension — and says it settles how dependencies reach an executor "so that the constraint holds by construction rather than by discipline."

It does not hold by construction. A factory opens a pooled connection and nothing in the protocol ever closes it, so every mechanism must wrap its own call to the handler in a `finally` and must itself remember what the factory took. A rule each mechanism separately remembers is discipline, which is the thing the sentence claimed to replace. The factory was not wrong; it said how a dependency comes to exist and never said how it stops.

The same section leaves a second gap. Supplying a dependency is optional, so an executor could be handed an empty object *typed as the shape its version declared* — every promised member absent, and nothing saying so. ADR-006 gave the substitution as a kindness, "so an executor written against it never has to test for its absence", and that justification is backwards: an executor written against something declared is exactly the party that must test.

This change implements [ADR-011: Dependency Lifetime](../../../../docs/adr/011-dependency-lifetime.md) and [ADR-012: Absent Dependencies and Hooks](../../../../docs/adr/012-absent-dependencies-and-hooks.md), which between them partially supersede that section and two rows of the execution context table.

## What Changes

- **BREAKING** `execute` accepts a dependency as one object exposing `open`, `close` and `attributes`. The value form and the factory form are both removed; `ArvoDependencyResolver` is removed from the public surface.
- `IArvoEventHandlerDependency` and `ArvoDependencyScope` are added to the public surface.
- The handler opens the dependency where the factory was called — the last gate step — and closes it in a `finally` around everything after it, so a refused return, a record that would not serialize, an expired clock, a cancellation and a raised fault all close.
- Reading `attributes` is part of opening: a surface that cannot be read is the same retry-safe fault, and `close` still runs because `open` had already succeeded.
- `open` failing stays `dependency_resolution_failed` and stays retry safe. `close` failing is recorded on the delivery span and discarded — never a fault, never visible to the mechanism.
- Both calls receive the event, the validated record or absence, the execution identifier, the attempt and the delivery's telemetry.
- The executor is handed `attributes`, so every `ctx.dependencies.x.y()` call site is unchanged and `close` is unreachable from an executor.
- Absence is `undefined` at the boundary a caller writes and `null` past it, normalized once. Applied to mechanism hooks at the same time, which preserves the distinction between a mechanism that exposed nothing and one that was never asked.
- **BREAKING** `ctx.dependencies` and `ctx.hooks` are `null` where nothing was supplied, rather than an empty object. An executor that needs what it declared states so and raises a fault naming it; one that can proceed without it does. The protocol decides neither and never refuses a delivery for it.

## Capabilities

### New Capabilities
- `event-handler-dependencies`: how what an executor works with is supplied, opened, read and released — and what the supplier of one owes in return.

### Modified Capabilities

None. The `event-handler` capability is still in flight under `declare-arvoeventhandler` and says nothing about how dependencies are supplied at execution time, so there is no requirement here to delta. What an executor finds where nothing was supplied belongs to the new capability for the same reason.

## Impact

- `src/ArvoEventHandler/types/dependency.ts` — new.
- `src/ArvoEventHandler/types/execute.ts`, `version/types.ts` — the param types.
- `src/ArvoEventHandler/index.ts` — normalizes absence once, for dependencies and hooks alike.
- `src/ArvoEventHandler/version/index.ts` — opens, reads, and closes in a `finally` around the rest of the execution.
- `src/ArvoEventHandler/version/telemetry.ts` — a helper for recording a failure the execution carried on from, which it lacked.
- `src/ArvoEventHandler/types/supplied.ts`, `src/index.ts` — `ArvoDependencyResolver` removed.
- `src/ArvoEventHandler/context/types.ts`, `context/index.ts` — both members nullable, and nothing invents an empty object.
- Every executor reaching for a declared dependency or a hook, in this repository and outside it.
- Every mechanism, in this repository and outside it. The sandbox's Temporal activity loses an array of release functions, a push into it, and a `finally`.

## Deliberately out of scope

- **Mechanism hooks are not given a lifetime.** ADR-011 decides that in the negative and states why, so this change documents the line between the two and changes nothing else about hooks. Their nullability is about absence being visible, not about a lifetime.
- **Obliging a mechanism to supply what a version declared.** ADR-012 rejects it: a mechanism routes an event to whichever handler it names, so the declared shape is not known at any call site and the obligation could only be satisfied by an assertion — the same unchecked claim, one layer earlier.
- **Per-version dependencies.** One dependency serves a handler, so `ArvoDependencyScope`'s state schema is optional and a supplier that omits it narrows the record itself. Supplying a dependency per version would type that record, and is a larger decision this change does not take.
- **Any pooling or sharing strategy.** A supplier may retain the object across deliveries and must not let anything live it holds survive one. How it does that is its own.
