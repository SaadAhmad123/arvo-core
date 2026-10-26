## Why

[ADR-019](../../../../../docs/adr/019-outbox.md) defines the outbox: the durable piece a mechanism may use to keep each execution's state and the events committed with it, so that it need not build its own. Today every mechanism that runs Arvo handlers writes that piece again — the compare-and-swap, the all-or-nothing commit, the recovery read, the publish-after-commit — and each can get any of it subtly wrong. arvo-core can give it one shape a developer implements once against their own storage.

This change implements ADR-019. It ships the interface a developer implements, the types that cross it, two outboxes of Arvo's own — one in memory, one in a SQLite file — and a conformance kit a developer runs against their own outbox to prove it meets every rule. ADR-019 names that kit as the next piece of work after its acceptance; without it, "a conforming outbox" is a claim nobody can check.

## What Changes

- **New interface `IArvoOutbox`**, the six operations of ADR-019: read the latest state, commit a state and its events, commit events alone, read committed events, list unseen events, and mark events seen. Plain methods: an implementer returns values and throws whatever their storage throws, as `IArvoEventHandlerDependency` already has it.
- **New types** for everything that crosses the interface: the event record as an outbox keeps it, the committed event record it hands back, the flat commit, the commit's outcome and its two refusals, and the three shapes of a committed-events filter.
- **New class `ArvoMemoryOutbox`**, at `arvo-core/outbox/inmemory`: an outbox that keeps everything in process memory. Production grade for one process that need not survive a restart — every rule held, constant work per call however much it holds, safe under concurrent calls — and the outbox tests and the driver's own tests run against.
- **New class `ArvoSqliteOutbox`**, at `arvo-core/outbox/sqlite`: an outbox in a SQLite file, which survives a restart with no database server to run. Production grade for one machine, including several processes sharing one file.
- **Three entry points**, so a consumer loads only what they use: `arvo-core` for the interface and its types, `arvo-core/outbox/inmemory`, and `arvo-core/outbox/sqlite`.
- **New conformance kit** at a separate entry point, `arvo-core/outbox/conformance`: every rule of ADR-019 as a check that can be run against any outbox, and one function that turns those checks into a vitest suite. A developer adds one test file, hands the kit a way to build a fresh outbox, and their outbox is held to the same rules as Arvo's own.
- **Two optional peer dependencies:** vitest, imported only by `arvo-core/outbox/conformance`, and `better-sqlite3`, imported only by `arvo-core/outbox/sqlite`. A consumer who does not import an entry point is not asked for what it needs.
- **BREAKING:** none. Entirely new surface.

## Capabilities

### New Capabilities

- `outbox`: what an outbox holds, the operations it offers, what each must do and may refuse, and how it is recovered from, as any implementation of the interface must behave.

### Modified Capabilities

None.

## Impact

- New source under `src/ArvoOutbox/`, one concern per file, with tests mirrored under `tests/ArvoOutbox/`.
- `src/index.ts` gains the interface and its types. `src/outbox/inmemory/`, `src/outbox/sqlite/` and `src/outbox/conformance/` are new, each exported as its own entry in the package's export map.
- `package.json`: vitest and `better-sqlite3` added as optional peer dependencies, and `better-sqlite3` with its types as development dependencies. No existing behaviour changes.

**ADR.** Implements [ADR-019](../../../../../docs/adr/019-outbox.md). Contradicts no accepted ADR.

**Not in scope.**

- **The outbox driver**, [ADR-020](../../../../../docs/adr/020-outbox-driver.md): building records from live events, converting to and from CloudEvent JSON, checking returns, and the one error with its kinds. A later change, which uses this one.
- **A conformance kit for the driver.** The driver is a later change, and its kit comes with it.
- **Checks that need a controlled clock,** such as the exact boundary of the age cut-off. A developer's outbox stamps times by its own storage's clock, which the kit cannot control, so those checks stay in the in-memory outbox's own tests.
- **Anything a mechanism does:** the queue, the sweeper, retry, abandonment, what to do with a refusal. ADR-019 leaves all of it with the mechanism, and so does this change.
- **Retention.** ADR-019 leaves it to the deployment. Neither outbox deletes anything; a deployment using the SQLite outbox may prune its file on its own schedule.
- **A lease.** ADR-019 recommends one where several sweepers share an outbox. Neither outbox leases in this change: the in-memory one serves one process, and the SQLite one is meant for one sweeper per file. A lease for the SQLite outbox is a later change if a deployment needs several sweepers.
- **Outboxes for servers,** such as Postgres. A developer implements `IArvoOutbox` and runs the kit; Arvo shipping one is a later change.
- **The sandbox.** Its Postgres store becomes an outbox in a later change.
