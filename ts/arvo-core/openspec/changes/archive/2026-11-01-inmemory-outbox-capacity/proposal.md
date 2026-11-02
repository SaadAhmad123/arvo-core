# Proposal

## Why

`IArvoOutbox` now has `capacity` and lets a commit refuse with `capacity_exhausted` (change `outbox-capacity`). The in-memory outbox has neither, so it no longer compiles. It also holds every state forever, and when full it drops seen events or throws, which ADR-019 rule 23 now forbids: a full outbox refuses, never throws.

## What Changes

- **BREAKING** `maxEvents` is removed, along with dropping seen events to make room and throwing where none can be dropped.
- New option `buffers`: `events` and `states`, each `{ size, tolerance }`, with defaults of the outbox's own. `limit = size × (1 + tolerance)`.
- New option `retentionMs`: `seenEvents` and `terminalStates`, each with a default of the outbox's own.
- `capacity(request)`: each buffer answers `available`, `tolerating` or `exhausted` with `held`, `size` and `limit`, and stays `tolerating` until it has drained well below `size`.
- Both commits refuse with `capacity_exhausted` where a buffer they fill would be exhausted. `commitEvents` answers its outcome.
- A sweep, on a timer from `open` until `close`, deletes events seen longer than `retentionMs.seenEvents` ago, and states at `success`, `error`, `cancelled` or `failure` whose last commit was longer than `retentionMs.terminalStates` ago. Its interval is worked out from the shorter retention.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `outbox`: the in-memory outbox's bound on events is replaced by two buffers, capacity, refusal at commit, and retention.

## Impact

- Implements [ADR-019](../../../../../docs/adr/019-outbox.md) rules 18–24, and its **Retention** section, for the in-memory outbox.
- Code: `src/outbox/inmemory/` and its tests.

### Deliberately not in scope

- **The SQLite outbox and the conformance kit.** They still do not compile, so `pnpm typecheck` and the test suite stay red, and **no test is run in this change**. Tests are written, and run once the next change brings both up to the interface.
- **Measuring memory.** The buffers count events and states, not bytes.
