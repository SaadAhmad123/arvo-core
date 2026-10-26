## Why

`IArvoOutbox` has no standard way to acquire and release what an outbox holds. Each implementation invents its own: `ArvoSqliteOutbox` opens its file in its constructor and adds a `close()` of its own, `ArvoMemoryOutbox` has neither, and a developer's Postgres outbox would add something else again. Whatever runs an outbox, and the conformance kit, cannot rely on any of them, so the kit tells a developer to track and close their outboxes by hand.

This is the TypeScript package's own API shape. [ADR-019](../../../../../docs/adr/019-outbox.md) leaves API shape to each language and says nothing about opening or closing an outbox; this change adds nothing to it and supersedes nothing. No ADR governs it.

## What Changes

- **`IArvoOutbox` gains `open()` and `close()`**, each answering directly or through a promise, like its other operations. An outbox is opened before it is used and closed after. Opening and closing may each be repeated, and every operation throws once the outbox is closed.
- **Arvo's own outboxes hold two rules more:** every operation throws before the outbox is opened, and opening a closed outbox throws. The kit does not require these of a developer's outbox, so one built on a pool that connects lazily, or one that may be reopened, still conforms.
- **BREAKING: `ArvoSqliteOutbox`'s constructor no longer opens its file.** It checks its options; `open()` creates the file, configures the connection, checks the version of its tables and creates them. A file that cannot be opened now throws from `open()` rather than from `new`. Unreleased, so no consumer is affected.
- **`ArvoMemoryOutbox` enforces the same states,** so code tested against it fails where it forgets to open, as it would in production, and `close()` frees what it holds.
- **The conformance kit opens and closes for the developer.** `createOutbox` returns an unopened outbox; the kit opens it before each case and closes it after, even where the case fails. It gains lifecycle cases: opening again, closing again, and every operation throwing once closed, each proven by an outbox broken in that way.

Not in scope: the outbox driver (ADR-020), and anything about who opens or closes an outbox in a running mechanism. Both are later changes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `outbox`: every outbox is opened before use and closed after; Arvo's own refuse use before opening and reopening after closing; the SQLite outbox opens its file on `open()`; the kit opens and closes each outbox it checks.

## Impact

- `src/ArvoOutbox/interface.ts`: two methods added to the interface every developer implements.
- `src/outbox/inmemory/outbox.ts` and `src/outbox/sqlite/outbox.ts`: lifecycle states, with a shared helper under `src/outbox/helpers/`.
- `src/outbox/conformance/`: the suite opens and closes around each case; new lifecycle cases; the param's TSDoc no longer tells a developer to close outboxes themselves.
- Tests under `tests/ArvoOutbox/` and `tests/outbox/`, including the broken outboxes and every test that builds an outbox, which now opens it.
- No new dependency. No ADR is touched.
