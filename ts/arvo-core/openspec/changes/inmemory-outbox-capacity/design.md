# Design

## Context

See proposal.md, **Why**. `src/outbox/inmemory/outbox.ts` holds a `MemoryStore` per open outbox, through `ArvoOutboxLifecycle`: the latest state per execution, every event by id, two indexes, and the unseen and seen events each in a `Map` whose insertion order is landing order and seen order. Every operation is synchronous, so nothing can run between a check and a write. The requirements are in `specs/outbox/spec.md`.

## Goals / Non-Goals

**Goals:**

- Bounded memory that refuses rather than throws, retention that keeps repeated deliveries safe, and capacity answered without looking through what is held.

**Non-Goals:**

- The SQLite outbox and the conformance kit (proposal, **Deliberately not in scope**).
- Measuring bytes. The buffers count items; the TSDoc says so.

## Decisions

### Options

```ts
type ArvoMemoryOutboxOptions = {
  readonly clock?: () => Date;
  readonly buffers?: {
    readonly events?: ArvoMemoryOutboxBuffer;
    readonly states?: ArvoMemoryOutboxBuffer;
  };
  readonly retentionMs?: {
    readonly seenEvents?: number;
    readonly terminalStates?: number;
  };
};

type ArvoMemoryOutboxBuffer = {
  readonly size: number;       // whole, greater than zero
  readonly tolerance: number;  // 0 to 1; limit = size × (1 + tolerance)
};
```

Defaults live in `helpers/defaults.ts`, as `defaultMaxEvents` does today: both buffers at size 10,000 and tolerance 0.2; seen events kept 5 minutes, terminal states 1 hour. Terminal states are kept longer because deleting one too early lets a repeated delivery start its execution again, while deleting a seen event too early costs nothing: the queue already has it.

A buffer given whole replaces the default whole; there is no merging of `size` without `tolerance`.

### The options are checked with zod

The constructor checks the whole options object with one zod schema: `clock` a function where given; each buffer's `size` a whole number greater than zero and `tolerance` a number from zero to one; each retention a whole number of milliseconds, zero or more; no unknown key. Every issue is reported at once in a new `ArvoMemoryOutboxValidationError`, in `src/outbox/inmemory/errors.ts`, shaped as every validation error in the package is: a `_tag`, `issues: readonly ErrorIssue[]` frozen, and a message from `buildErrorIssueMessage`. The issues are zod's own, so no message text is written by hand. It **replaces** the `RangeError` the outbox throws today for a bad `maxEvents`, which was a one-off and not the package's standard.

The schema is built inside the constructor and never held at module level (project.md, **Module-level state**). It runs through `checkAgainstSchema`, which **moves** from `src/ArvoOutboxDriver/helpers/` to `src/utils/check-against-schema.ts`, since two modules now use it; the driver's imports follow it.

*Alternative:* checking each value by hand. Rejected: zod is already a dependency, and the driver already checks its shapes with it.

*Alternative:* keeping `maxEvents` beside `buffers.events`. Rejected: two ways to say one thing.

### Counting

The store gains nothing to count: events held is `eventsById.size`, states held is `latestStateByExecution.size`, so capacity is constant time, as **Arvo's Outboxes Do The Same Work However Much They Hold** requires.

- `capacity(request)` adds `request.events` to events, and one to states where `request.state?.casVersion === 0`. It is an estimate: an event already held is counted again, and a first revision for an execution already stored is counted though it would be refused.
- A commit counts exactly: the events it would store (`withoutHeldEvents`, already deduplicated), and one state where no state is stored for its execution.

Both go through one helper, `helpers/buffer-capacity.ts`, which takes held, size, tolerance and the steady flag, and answers an `ArvoOutboxBufferCapacity`.

### The steady answer

Each buffer has a flag in the store, `tolerating`. After every write and every sweep, for each buffer: set where held is past `size`, cleared where held is at or below `size × (1 − tolerance)`. A capacity answer is `exhausted` past the limit, else `tolerating` where the flag is set or held is past `size`, else `available`. The flag is only changed by what changes what is held, so asking changes nothing.

### Refusing at commit

`commitStateAndEvents` checks, in order: the revision (`refusalFor`), then the states buffer, then the events buffer, each before the first write, answering the first refusal. `commitEvents` checks the events buffer. A refusal is `{ committed: false, refusal: 'capacity_exhausted' }`. `countEventsToDrop` and `dropSeenEvents` are **removed**.

### Retention and the sweep

Two orders let a sweep stop at the first item not yet expired, so it does work in proportion to what it deletes:

- **Seen events:** `seenEventsById` already holds them in seen order. `StoredEvent` gains `seenAtMs`, set by `markEventsSeen` from the clock.
- **Terminal states:** a new `terminalStatesByExecution: Map<string, number>`, the last commit time of each state at a terminal lifecycle. On every state commit the execution is deleted from it and, where the lifecycle is terminal, set again, so insertion order is last-commit order. Deleting a state deletes it from both maps and leaves its events.

The terminal lifecycles are one frozen array, checked with `includes`. Reading `lifecycle` is matching a field ADR-019 hands the outbox beside the record, against ADR-007's fixed terminal values. It decides nothing the protocol depends on, so ADR-019's **Not a judge** rule is not engaged, and no ADR changes.

`open()` starts a `setInterval` after the store exists, and calls `unref()` on it. The interval is `max(1000, min(seenEvents, terminalStates) / 10)`, so nothing outlives its retention by more than a tenth of it, or a second. `close()` clears it before the store is released. The timer handle is held by the outbox instance, never at module level.

A tick reads the clock once. Where the clock throws or returns no valid time, the tick writes one `console.warn` and deletes nothing, since an exception thrown from a timer would end the process. After deleting, it updates both steady flags.

Commits and capacity calls do not sweep. Between ticks, expired items still count, so an answer may read high by up to one interval; ADR-019 rule 19 allows an estimate.

*Alternatives:* sweeping in every commit and capacity call as well (rejected by the developer as complexity the domain does not need), and capping how much one tick deletes (likewise).

### Tests

`tests/outbox/inmemory/outbox.spec.ts` drives time through `options.clock`, and the timer with Vitest's fake timers only to fire ticks. No test is run in this change.

## Risks / Trade-offs

- [Retention shorter than the queue's redelivery time lets a repeated delivery restart a finished execution] → The TSDoc says each retention must outlast how long the queue may deliver an event again; the default for states is the longer one.
- [The buffers count items, not bytes] → Stated in the TSDoc.
- [Expired items count until the next tick] → Bounded by the interval, and allowed as an estimate.
- [The build stays red] → Agreed; the next change brings the SQLite outbox and the conformance kit up to the interface and runs every test.

## Migration Plan

Replace `maxEvents: n` with `buffers: { events: { size: n, tolerance } }`. A commit that used to throw for lack of room is now answered refused as `capacity_exhausted`.
