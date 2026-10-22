## Why

A handler and a dispatcher each take their telemetry when they are built and keep it. Where none is given, the default tracer is taken at that moment, and since OpenTelemetry API 1.10.0 a tracer taken before an SDK is registered can stay silent for good: the API now loads as two separate copies, one for ES modules and one for CommonJS, and only the copy the SDK registered through learns of it. A handler built at import, before the application registers its SDK, then records nothing and its log lines carry no trace.

Telemetry also belongs to whoever runs a handler, not to the handler. A dispatcher already decides the layers every handler it enters runs under; where its handlers record is the same kind of decision, and a handler entered by a dispatcher should have no more say over it than over the event it is given.

## What Changes

- **BREAKING** — `setupArvoEventHandler` no longer accepts `telemetry`, and a built handler no longer holds it: the `telemetry` property is removed from `ArvoEventHandler`.
- **BREAKING** — `createArvoDispatcher` and `tryCreateArvoDispatcher` no longer accept `telemetry`, and the `telemetry` property is removed from `ArvoDispatcher`.
- A handler's `tryExecute` and `execute` take an optional `telemetry`. Given, it is used as given. Not given, the default is resolved at that call.
- A dispatcher's `tryExecute` and `execute` take the same optional `telemetry`. The dispatcher resolves it at that call in the same way, records its own span with it, and always enters the handler with that resolved telemetry, so the handler never resolves its own.
- Telemetry lives for the length of one call and is held by nothing between calls.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `event-handler`: where a handler's execution records is given per execution, not declared; a declaration no longer names telemetry.
- `event-dispatcher`: a dispatcher is entered with optional telemetry, records with it, and enters the handler with it; a declaration no longer names telemetry.

## Impact

- `src/ArvoEventHandler/` — the setup type and the setup builder lose `telemetry`; the handler loses its `telemetry` property and resolves telemetry inside `tryExecute`; the execute parameter type gains `telemetry`.
- `src/ArvoDispatcher/` — options lose `telemetry`; the class loses its `telemetry` property; the execute parameter type gains `telemetry`; `tryExecute` resolves it and passes it to the handler.
- `src/ArvoEventHandler/context/telemetry/resolve.ts` — unchanged in shape; now called per execution rather than per construction.
- Tests that pass a tracer at construction move it to the call. Tests that read the `telemetry` property assert on the recorded spans instead.
- Consumers that pass telemetry at construction move it to each call. The sandbox mechanisms will pass their logger and meter on every call; that follow-up is outside this package.

**ADR.** No ADR changes. ADR-017 fixes that a dispatcher records and what it hands on, not where its telemetry comes from; its rule that a dispatcher takes exactly what a handler takes, less middleware, still holds, since both gain `telemetry`. ADR-006 requires the OpenTelemetry objects on the execution context and leaves how they reach it to each language, as ADR-004 leaves all API shape. ADR-018 is untouched: what a layer opens and hands on is unchanged.

**Not in scope.**

- What a dispatcher's or a handler's span records, its name, its status rules, and what is handed on with the event. All unchanged.
- A per-handler telemetry override inside a dispatcher. A handler entered by a dispatcher takes the dispatcher's telemetry, with no exception.
- Upstream reporting of the OpenTelemetry module duplication.
- The parked catch-parameter naming question.
