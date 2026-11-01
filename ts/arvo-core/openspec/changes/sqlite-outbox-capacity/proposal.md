# Proposal

## Why

`IArvoOutbox` now has `capacity`, and `commitEvents` answers an outcome (change `outbox-capacity`). The SQLite outbox and the conformance kit have neither, so the package does not compile, and no test has run since. The SQLite outbox also keeps every finished execution's state forever, and refuses bad options with `RangeError`, not the package's validation error.

## What Changes

- `ArvoSqliteOutbox.capacity` answers `available` with no buffers: it limits nothing (ADR-019 rule 21). A full disk is the deployment's to watch.
- `commitEvents` answers `{ committed: true }`.
- **BREAKING** `retainSeenEventsForMs` is replaced by `retentionMs: { seenEvents?, terminalStates? }`, matching the in-memory outbox. A state at `success`, `error`, `cancelled` or `failure` is deleted once its last commit is older than `terminalStates`, deleted as seen events already are: a bounded batch on each marking, and every expired one on a call.
- **BREAKING** `deleteExpiredEvents()` becomes `deleteExpired()`, deleting expired states as well as events, and answering how many of each.
- **BREAKING** The file's tables move to version 2: each state row records when it was last committed. A version 1 file is refused, as any unknown version is.
- **BREAKING** Bad options throw `ArvoSqliteOutboxValidationError`, carrying every issue, checked with zod, in place of `RangeError`. `tryCreateArvoSqliteOutbox` and `createArvoSqliteOutbox` are added.
- The conformance kit checks capacity on every outbox: a valid answer, asking changes nothing, the overall status the worst of the buffers. It checks that `commitEvents` answers its outcome. Its broken outboxes are brought up to the interface.
- The whole suite runs again, at 100% coverage, including what changes `outbox-capacity` and `inmemory-outbox-capacity` wrote without running.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `outbox`: the SQLite outbox answers capacity, deletes terminal states, and refuses bad options with its own error; the conformance kit checks capacity.

## Impact

- Implements [ADR-019](../../../../../docs/adr/019-outbox.md) rules 18–24 and **Retention** for the SQLite outbox and the kit.
- Code: `src/outbox/sqlite/`, `src/outbox/conformance/`, their tests, and `tests/outbox/inmemory/broken-outboxes.ts`.

### Deliberately not in scope

- **Limits for SQLite.** It refuses nothing for room. Buffers would need counts kept by triggers that every process on the file maintains; that is a later change if a deployment needs it.
- **A timer for SQLite.** Deleting stays on marking seen and on `deleteExpired()`, so several processes on one file never each run one.
- **Migrating a version 1 file.** The package is unreleased; a version 1 file is refused.
