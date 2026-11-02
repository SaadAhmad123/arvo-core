# Proposal

## Why

The load runs (change `outbox-load-tests`, **Findings**) showed the driver rebuilding its answer schemas on every call, two facts a developer meets with no warning, and defaults that a modest steady load outgrows.

## What Changes

- `ArvoOutboxDriver` builds its capacity, commit-outcome and committed-records schemas once, in its constructor, and checks every answer against them.
- `ArvoSqliteOutbox.deleteExpired()`'s TSDoc says it holds the thread until it is done.
- `ArvoSqliteOutboxOptions.filename`'s TSDoc says a change to the file's permissions must reach its `-wal` and `-shm` files too.
- New defaults. In-memory: each buffer's size 50,000; seen events kept a minute; terminal states ten minutes. SQLite: a busy wait of a second; seen events and terminal states kept a day.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. Every requirement names a default "of its own", never its value, so no requirement changes.

## Impact

- No ADR governs these values; ADR-019 leaves retention to the deployment.
- Code: `src/ArvoOutboxDriver/`, `src/outbox/inmemory/helpers/resolve-options.ts`, `src/outbox/sqlite/helpers/resolve-options.ts`, `src/outbox/sqlite/outbox.ts`, `src/outbox/sqlite/types.ts`, and their tests.
- **BREAKING, in behaviour only**: a deployment relying on the old defaults keeps less for less long, and a SQLite outbox waits less for a busy file.
