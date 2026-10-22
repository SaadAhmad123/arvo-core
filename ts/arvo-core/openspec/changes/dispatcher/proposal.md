## Why

[ADR-017](../../../../../docs/adr/017-dispatcher.md), Accepted, names the set of handlers ADR-006 already rests a rule on, and fixes what a dispatcher over that set refuses, does and must not do. Today every caller that runs several handlers finds the right one by hand, and nothing rejects the defects only the whole set can show. This change implements ADR-017 in `ts/arvo-core`.

## What Changes

- **A new public class, `ArvoDispatcher`**, built through `createArvoDispatcher` / `tryCreateArvoDispatcher`. Its constructor holds the logic and throws `ArvoDispatcherValidationError`, a new error class shaped like `ArvoEventHandlerValidationError`.
- **Declaration-time refusals**, every rule broken reported at once: an empty set; one handler listed twice; two handlers whose self contracts share a `type`; a service one handler declares that another in the set implements at an undeclared version, or under the same `type` with a different `uri`.
- **One verb, `tryExecute` / `execute`**, taking exactly the handler's execute parameter less `middleware`, and returning exactly what the handler returns. It picks the handler whose self contract `type` is `event.to`, hands it its own dependency entry and the set's layers, and returns its response unchanged.
- **A new fault kind, `handler_not_found`**, non-retryable and carrying no abandonment pair, raised where no handler in the set takes `event.to`. `createArvoHandlerFault` learns to build a fault for an event that reached no handler.
- **Three reads of the set**: whether a `type` is handled here; the longest run timeout any version declares; and `tryValidateCallerName` / `validateCallerName`, refusing a name that breaks the contract identifier grammar or collides with a handler's self or service contract `type`.
- **Layers of the set**, accepted at construction only and handed to every handler as its supplied layers. The dispatcher judges nothing about them.
- **One span per call, under [ADR-018](../../../../../docs/adr/018-trace-context-across-layers.md).** The dispatcher continues the event's trace, enters the handler with a copy of the event naming its span where the span records, marks the pick, and records `handler_not_found` on it. It takes an optional `telemetry` option shaped as a handler's. It depends on `mutateArvoEvent` from the `mutate-event` change.
- **One telemetry resolver for every party.** `resolveTelemetry` and `ArvoTelemetryParam` move the handler and the dispatcher onto one default. **BREAKING** for telemetry only: a handler's default tracer is now named `arvo-core`, as ADR-018 asks, rather than after its contract type.
- **Exports** from `src/index.ts` for the class, its two factories, its validation error, and its option and parameter types.

## Capabilities

### New Capabilities

- `event-dispatcher`: a set of handlers entered as one handler — what it refuses at declaration, how it picks a handler and what it passes on, the one fault it raises, what it can be asked about its set, the layers it carries, and everything it must not do.

### Modified Capabilities

None. `event-handler` and `event-handler-middleware` are unchanged: a handler entered through a dispatcher behaves exactly as one entered directly, and the dispatcher's layers are ADR-016's supplied layers. The fault factory's new branch is an implementation detail with no handler-level requirement attached.

## Impact

- **New code** under `src/ArvoDispatcher/`: the class, its error, its declaration checks, its types, and the set-level type helpers. New factories under `src/factories/`.
- **Changed code**: `src/ArvoEventHandler/fault/types.ts` gains `handler_not_found` on `ArvoFaultKind` and a third branch on the fault factory's parameter; `src/ArvoEventHandler/fault/factory.ts` builds that branch. `src/ArvoContract/validator.ts` shares its identifier check rather than having it copied. `src/index.ts` gains the new exports.
- **No new dependencies.** Every addition is new surface. The one existing type that changes is `ArvoFaultKind`, which gains a member: a consumer's exhaustive `switch` over it needs one more case to compile, as it did when ADR-016 added two.

## Not in scope

- **Anything a mechanism does.** Committing the record and the events, redelivery after a refused commit, deciding where a produced event goes, retry, abandonment, who may push an event in. ADR-017 keeps all of these with the mechanism, and the runtime that will do them is a later change.
- **Infrastructure adapter interfaces.** ADR-000 defers them; a dispatcher is not one.
- **The sealed node** and **the formal definition of an Arvo application.** ADR-000 defers both; nothing here names or approaches either.
- **Layers supplied per call.** ADR-017 fixes a dispatcher's layers at declaration; `execute` takes none.
- **Any change to the handler.** Its behaviour, gate and options are untouched.
