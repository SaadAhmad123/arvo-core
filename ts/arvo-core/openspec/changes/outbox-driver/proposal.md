## Why

[ADR-020](../../../../../docs/adr/020-outbox-driver.md) puts one party in front of every outbox: the outbox driver. An outbox is deliberately plain, returning values and throwing whatever its storage throws, while Arvo must validate everything crossing a boundary and report failure in its own shape. Without a driver, every place Arvo touches an outbox writes that translation again, and each can differ in how it builds an event record, what it trusts, and what a failure becomes.

This change implements ADR-020 in arvo-core, now that the outbox it stands in front of exists.

## What Changes

- **New class `ArvoOutboxDriver`**, built once with the outbox it calls and exported from `arvo-core`: the only party that calls an outbox, forwarding its opening and closing as well as its six operations. It does not satisfy `IArvoOutbox`.
- **On the way in,** it builds everything the outbox stores: each live event becomes CloudEvent JSON through ADR-003's forward transformation and an event record beside it, and the commit's fields are lifted off the execution record, so the outbox never opens either. It removes no duplicates.
- **On the way out,** it checks every return before Arvo sees it, and restores each payload to a live event through ADR-003's strict reverse, on by default and off per read for a caller that only forwards the string.
- **New error `ArvoOutboxDriverError`,** one type for every failure the driver reports, carrying exactly ADR-020's six kinds, the operation, and the cause. A refused commit is reported as this error.
- **New error `ArvoOutboxDriverValidationError`,** thrown where a record handed to the driver lacks a field it must lift: a defect in the caller, not a failure of the outbox, so not one of ADR-020's kinds.
- **Each operation is a `tryX`/`X` pair**, the value-returning and throwing forms reporting the same error, with one span per call continuing the active trace and telemetry given per call.

Not in scope, each deferred by ADR-020: how a handler's state function is built from the driver's read; what a mechanism does with each kind; a conformance kit for drivers.

## Capabilities

### New Capabilities

- `outbox-driver`: what the driver builds for an outbox, what it checks and restores from one, the error it reports and its kinds, and what it never decides.

### Modified Capabilities

None.

## Impact

- New source under `src/ArvoOutboxDriver/`, one concern per file, exported from `src/index.ts`, with tests mirrored under `tests/ArvoOutboxDriver/`.
- Reuses `ArvoEventSerializer` for both directions and `resolveTelemetry` for spans. No new dependency, and no new entry point.
- No ADR is changed.
