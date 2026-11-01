# Design

## Context

See proposal.md, **Why**. `src/outbox/sqlite/outbox.ts` checks its options by hand in the constructor and throws `RangeError`. It keeps only each execution's latest state, in `arvo_outbox_state`, and deletes seen events in batches: `deleteExpiredBatch` on every `markEventsSeen`, and every batch on `deleteExpiredEvents()`. Times come from SQLite's clock. The in-memory outbox (change `inmemory-outbox-capacity`) is the model for options, errors and factories. The requirements are in `specs/outbox/spec.md`.

## Goals / Non-Goals

**Goals:**

- The SQLite outbox on the new interface, with retention matching the in-memory outbox, and options handled the same way.
- The kit checking capacity on every outbox, and the whole suite running again at full coverage.

**Non-Goals:**

- Limits, a timer, or migrating a version 1 file (proposal, **Deliberately not in scope**).

## Decisions

### Capacity: limits nothing

`capacity()` asks the lifecycle for its connection, so it throws once closed like every operation, and answers `{ status: 'available', buffers: {} }`. It reads nothing from the file. `commitEvents` answers `{ committed: true }` after its transaction.

*Alternative:* buffers with counts kept by triggers. Rejected for now: it is the one way to count in constant time across processes on one file, and a full disk is better watched by the deployment.

### Options, as the in-memory outbox has them

```ts
type ArvoSqliteOutboxOptions = {
  readonly filename: string;
  readonly busyTimeoutMs?: number;
  readonly retentionMs?: {
    readonly seenEvents?: number;      // whole ms, zero or more, or Infinity
    readonly terminalStates?: number;  // likewise
  };
};
```

- `helpers/check-options.ts`: one zod schema, built per call, through `checkAgainstSchema`, throwing `ArvoSqliteOutboxValidationError`. A retention is `z.union([z.number().int().nonnegative(), z.literal(Infinity)])`; `Infinity` stays, as `retainSeenEventsForMs` has it, to keep something forever.
- `helpers/resolve-options.ts`: every option default, the existing seven days for seen events, and the same for terminal states. The defaults for statements and the connection stay in `helpers/defaults.ts`, which loses `defaultBusyTimeoutMs` and `defaultRetainSeenEventsForMs`.
- `errors.ts`: `ArvoSqliteOutboxValidationError`, shaped as `ArvoMemoryOutboxValidationError` is.
- `factory.ts`: `tryCreateArvoSqliteOutbox` and `createArvoSqliteOutbox`, as for the in-memory outbox.

The constructor is `resolveOptions(checkOptions(options))`, then the lifecycle; it still touches no file.

### Tables at version 2

`outboxSchemaVersion` becomes `'2'`. `arvo_outbox_state` gains `committed_at text not null`, stamped by SQLite's clock in the commit, as events are. A partial index finds terminal states by age:

```sql
create index if not exists arvo_outbox_state_terminal_by_commit
  on arvo_outbox_state (committed_at)
  where lifecycle in ('success', 'error', 'cancelled', 'failure');
```

A version 1 file is refused by the existing check, whose message already names both versions. Reading `lifecycle` is matching a field the commit hands the outbox, as in the in-memory outbox's design.

### Deleting

`deleteExpiredBatch` deletes up to one batch of expired events, then up to one batch of expired terminal states, each skipped where its retention is `Infinity`, and answers both counts. Marking seen frees pages where either is above zero. `deleteExpiredEvents()` is **renamed** `deleteExpired()`, looping until a batch deletes fewer than the batch size of each, and answering `{ events, states }`.

### The conformance kit

A new case file, `cases/capacity-is-answered.ts`, registered in `cases/index.ts`:

- capacity answers a known status overall and for each buffer given, and `held`, `size` and `limit` are whole numbers zero or more where given;
- the overall status is the worst of the buffers given;
- asking changes nothing: a state and events committed, capacity asked, and both read back as they were, the events still unseen and listed;
- a commit of events alone answers committed, or refused as `capacity_exhausted`.

`tests/outbox/inmemory/broken-outboxes.ts` gains an outbox breaking each of those, and its existing outboxes gain `capacity` and the `commitEvents` outcome.

### The whole suite

Once `pnpm typecheck` is clean, the whole suite runs with coverage. The three outbox changes wrote tests that never ran; whatever fails or leaves a line uncovered is fixed here, in the group it belongs to.

## Risks / Trade-offs

- [A SQLite outbox never pushes back for room] → Accepted, and stated in its TSDoc; a disk filling is the deployment's to watch.
- [A version 1 file is refused] → The package is unreleased; the message says to open it with the version that wrote it.
- [Tests written without running may fail in ways that need design changes] → Each failure is fixed in its own group and shown for review; a failure that changes a requirement goes back to the change that owns it.

## Migration Plan

Replace `retainSeenEventsForMs: n` with `retentionMs: { seenEvents: n }`, and `deleteExpiredEvents()` with `deleteExpired().events`. Catch `ArvoSqliteOutboxValidationError` in place of `RangeError`.
