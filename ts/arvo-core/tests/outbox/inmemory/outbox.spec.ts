import { describe, expect, it, vi } from 'vitest';
import { buildEventRecord } from '../../../src/outbox/conformance/fixtures/event-record.js';
import { buildStateCommit } from '../../../src/outbox/conformance/fixtures/state-commit.js';
import { ArvoMemoryOutbox } from '../../../src/outbox/inmemory/index.js';
import type { JSONObject } from '../../../src/types.js';

/** A clock reading whatever time the test moves it to. */
const createSettableClock = (startMs: number) => {
  let nowMs = startMs;
  return {
    clock: vi.fn(() => new Date(nowMs)),
    moveTo: (movedToMs: number) => {
      nowMs = movedToMs;
    },
  };
};

const startMs = Date.parse('2026-01-01T00:00:00.000Z');

describe('ArvoMemoryOutbox and its clock', () => {
  it('reads the clock once per commit, however many events it carries', () => {
    const { clock } = createSettableClock(startMs);
    const outbox = new ArvoMemoryOutbox({ clock });
    const executionId = crypto.randomUUID();
    outbox.commitStateAndEvents(
      buildStateCommit({
        executionId,
        casVersion: 0,
        events: [
          buildEventRecord({ executionId }),
          buildEventRecord({ executionId }),
        ],
      }),
    );
    expect(clock).toHaveBeenCalledTimes(1);
    outbox.commitEvents({
      events: [
        buildEventRecord({ executionId }),
        buildEventRecord({ executionId }),
      ],
    });
    expect(clock).toHaveBeenCalledTimes(2);
    for (const committedEvent of outbox.readCommittedEvents({
      executionId,
    })) {
      expect(committedEvent.committedAt).toBe(new Date(startMs).toISOString());
    }
  });

  it('stamps by the system clock where none is given', () => {
    const outbox = new ArvoMemoryOutbox();
    const event = buildEventRecord();
    const beforeMs = Date.now();
    outbox.commitEvents({ events: [event] });
    const afterMs = Date.now();
    const [committedEvent] = outbox.readCommittedEvents({
      triggeringEventId: event.triggeringEventId,
    });
    const committedAtMs = Date.parse(committedEvent?.committedAt ?? '');
    expect(committedAtMs).toBeGreaterThanOrEqual(beforeMs);
    expect(committedAtMs).toBeLessThanOrEqual(afterMs);
  });

  it('lists an unseen event exactly as old as the cut-off, and none younger', () => {
    const { clock, moveTo } = createSettableClock(startMs);
    const outbox = new ArvoMemoryOutbox({ clock });
    outbox.commitEvents({ events: [buildEventRecord()] });
    moveTo(startMs + 1000);
    expect(
      outbox.listUnseenEvents({ atMost: 10, olderThanMs: 1000 }),
    ).toHaveLength(1);
    expect(
      outbox.listUnseenEvents({ atMost: 10, olderThanMs: 1001 }),
    ).toHaveLength(0);
  });

  it('lists events landing at the same time in the order committed', () => {
    const { clock } = createSettableClock(startMs);
    const outbox = new ArvoMemoryOutbox({ clock });
    const executionId = crypto.randomUUID();
    const eventsInCommitOrder = [
      buildEventRecord({ executionId }),
      buildEventRecord({ executionId }),
      buildEventRecord({ executionId }),
    ];
    outbox.commitStateAndEvents(
      buildStateCommit({
        executionId,
        casVersion: 0,
        events: eventsInCommitOrder.slice(0, 2),
      }),
    );
    outbox.commitEvents({ events: eventsInCommitOrder.slice(2) });
    const unseenEvents = outbox.listUnseenEvents({
      atMost: 10,
      olderThanMs: 0,
    });
    expect(unseenEvents.map((event) => event.id)).toEqual(
      eventsInCommitOrder.map((event) => event.id),
    );
  });

  it('stamps a commit no earlier than the one before, where the clock goes back', () => {
    const { clock, moveTo } = createSettableClock(startMs);
    const outbox = new ArvoMemoryOutbox({ clock });
    const earlierEvent = buildEventRecord();
    const laterEvent = buildEventRecord();
    outbox.commitEvents({ events: [earlierEvent] });
    moveTo(startMs - 5000);
    outbox.commitEvents({ events: [laterEvent] });
    moveTo(startMs);
    const unseenEvents = outbox.listUnseenEvents({
      atMost: 10,
      olderThanMs: 0,
    });
    expect(unseenEvents.map((event) => event.id)).toEqual([
      earlierEvent.id,
      laterEvent.id,
    ]);
    expect(unseenEvents.map((event) => event.committedAt)).toEqual([
      new Date(startMs).toISOString(),
      new Date(startMs).toISOString(),
    ]);
  });

  it('throws where the clock gives no valid time, having written nothing', () => {
    const outbox = new ArvoMemoryOutbox({ clock: () => new Date(Number.NaN) });
    const executionId = crypto.randomUUID();
    const event = buildEventRecord({ executionId });
    expect(() =>
      outbox.commitStateAndEvents(
        buildStateCommit({ executionId, casVersion: 0, events: [event] }),
      ),
    ).toThrow(RangeError);
    expect(outbox.readLatestState(executionId)).toBeNull();
    expect(outbox.readCommittedEvents({ executionId })).toEqual([]);
  });
  it('throws on listing unseen events where the clock gives no valid time', () => {
    const outbox = new ArvoMemoryOutbox({ clock: () => new Date(Number.NaN) });
    expect(() =>
      outbox.listUnseenEvents({ atMost: 10, olderThanMs: 0 }),
    ).toThrow(
      "ArvoMemoryOutbox's clock returned Invalid Date; a clock must return a valid Date.",
    );
  });
});

describe('ArvoMemoryOutbox under overlapping callers', () => {
  /** Calls an operation the way an awaiting caller does, a turn later. */
  const inAnotherTurn = <Answer>(operation: () => Answer) =>
    Promise.resolve().then(operation);

  it('commits exactly one of two commits racing for one revision', async () => {
    const outbox = new ArvoMemoryOutbox();
    const executionId = crypto.randomUUID();
    const firstOutcomes = await Promise.all([
      inAnotherTurn(() =>
        outbox.commitStateAndEvents(
          buildStateCommit({ executionId, casVersion: 0 }),
        ),
      ),
      inAnotherTurn(() =>
        outbox.commitStateAndEvents(
          buildStateCommit({ executionId, casVersion: 0 }),
        ),
      ),
    ]);
    expect(firstOutcomes).toEqual([
      { committed: true },
      { committed: false, refusal: 'state_exists' },
    ]);
    const laterOutcomes = await Promise.all([
      inAnotherTurn(() =>
        outbox.commitStateAndEvents(
          buildStateCommit({ executionId, casVersion: 1 }),
        ),
      ),
      inAnotherTurn(() =>
        outbox.commitStateAndEvents(
          buildStateCommit({ executionId, casVersion: 1 }),
        ),
      ),
    ]);
    expect(laterOutcomes).toEqual([
      { committed: true },
      { committed: false, refusal: 'revision_stale' },
    ]);
  });

  it('shows a read overlapping a commit all of its events or none', async () => {
    const outbox = new ArvoMemoryOutbox();
    const executionId = crypto.randomUUID();
    const [eventsReadBefore] = await Promise.all([
      inAnotherTurn(() => outbox.readCommittedEvents({ executionId })),
      inAnotherTurn(() =>
        outbox.commitEvents({
          events: [0, 1, 2].map(() => buildEventRecord({ executionId })),
        }),
      ),
    ]);
    const [, eventsReadAfter] = await Promise.all([
      inAnotherTurn(() =>
        outbox.commitEvents({
          events: [0, 1, 2].map(() => buildEventRecord({ executionId })),
        }),
      ),
      inAnotherTurn(() => outbox.readCommittedEvents({ executionId })),
    ]);
    expect(eventsReadBefore).toHaveLength(0);
    expect(eventsReadAfter).toHaveLength(6);
  });
});

describe('ArvoMemoryOutbox and what it holds', () => {
  it('keeps what was committed from changes made after', () => {
    const outbox = new ArvoMemoryOutbox();
    const executionId = crypto.randomUUID();
    const nestedList: JSONObject[] = [{ step: 'committed' }];
    const state: JSONObject = { nested: { list: nestedList } };
    const event = buildEventRecord({ executionId, payload: '"committed"' });
    outbox.commitStateAndEvents(
      buildStateCommit({ executionId, casVersion: 0, state, events: [event] }),
    );
    nestedList.push({ step: 'changed' });
    Object.assign(event, { payload: '"changed"' });
    expect(outbox.readLatestState(executionId)).toEqual({
      nested: { list: [{ step: 'committed' }] },
    });
    const [committedEvent] = outbox.readCommittedEvents({ executionId });
    expect(committedEvent?.payload).toBe('"committed"');
  });

  it('keeps what is stored from changes to what was read', () => {
    const outbox = new ArvoMemoryOutbox();
    const executionId = crypto.randomUUID();
    outbox.commitStateAndEvents(
      buildStateCommit({
        executionId,
        casVersion: 0,
        state: { step: 'stored' },
        events: [buildEventRecord({ executionId, payload: '"stored"' })],
      }),
    );
    const readState = outbox.readLatestState(executionId);
    if (readState) readState.step = 'changed';
    for (const readEvents of [
      outbox.readCommittedEvents({ executionId }),
      outbox.listUnseenEvents({ atMost: 10, olderThanMs: 0 }),
    ]) {
      for (const readEvent of readEvents)
        Object.assign(readEvent, { payload: '"changed"', seen: true });
    }
    expect(outbox.readLatestState(executionId)).toEqual({
      step: 'stored',
    });
    const [committedEvent] = outbox.readCommittedEvents({ executionId });
    expect(committedEvent?.payload).toBe('"stored"');
    expect(committedEvent?.seen).toBe(false);
  });

  it('stores only the fields of an event record', () => {
    const outbox = new ArvoMemoryOutbox();
    const event = buildEventRecord();
    // deliberately more than an event record, as a caller without types could pass
    outbox.commitEvents({
      events: [{ ...event, ...{ committedAt: 'forged', extra: 1 } }],
    });
    const [committedEvent] = outbox.readCommittedEvents({
      triggeringEventId: event.triggeringEventId,
    });
    expect(Object.keys(committedEvent ?? {}).sort()).toEqual(
      [...Object.keys(event), 'committedAt', 'seen'].sort(),
    );
    expect(committedEvent?.committedAt).not.toBe('forged');
  });

  it('throws on a state it cannot copy, having written nothing', () => {
    const outbox = new ArvoMemoryOutbox();
    const executionId = crypto.randomUUID();
    const state: JSONObject = {};
    // deliberately not JSON, as a caller without types could pass
    Object.assign(state, { callback: () => undefined });
    const event = buildEventRecord({ executionId });
    expect(() =>
      outbox.commitStateAndEvents(
        buildStateCommit({
          executionId,
          casVersion: 0,
          state,
          events: [event],
        }),
      ),
    ).toThrow();
    expect(outbox.readLatestState(executionId)).toBeNull();
    expect(outbox.readCommittedEvents({ executionId })).toEqual([]);
    expect(
      outbox.commitStateAndEvents(
        buildStateCommit({ executionId, casVersion: 0 }),
      ),
    ).toEqual({ committed: true });
  });

  it('answers every operation directly, not through a promise', () => {
    const outbox = new ArvoMemoryOutbox();
    const executionId = crypto.randomUUID();
    const answers = [
      outbox.readLatestState(executionId),
      outbox.commitStateAndEvents(
        buildStateCommit({ executionId, casVersion: 0 }),
      ),
      outbox.commitEvents({ events: [] }),
      outbox.readCommittedEvents({ executionId }),
      outbox.listUnseenEvents({ atMost: 10, olderThanMs: 0 }),
      outbox.markEventsSeen([]),
    ];
    for (const answer of answers) expect(answer).not.toBeInstanceOf(Promise);
    expect(answers.slice(0, 2)).toEqual([null, { committed: true }]);
  });

  it("reads one delivery's events without looking through the others", () => {
    const triggeringEventId = crypto.randomUUID();
    /** The fastest of several batches of reads, so a busy machine adds no time. */
    const fastestReadsOfOneDelivery = (otherEventCount: number) => {
      const outbox = new ArvoMemoryOutbox({ maxEvents: otherEventCount + 1 });
      outbox.commitEvents({
        events: [
          buildEventRecord({ triggeringEventId }),
          ...Array.from({ length: otherEventCount }, () => buildEventRecord()),
        ],
      });
      const batchMs = Array.from({ length: 5 }, () => {
        const startedMs = performance.now();
        for (let readCount = 0; readCount < 2000; readCount += 1) {
          outbox.readCommittedEvents({ triggeringEventId });
          outbox.readCommittedEvents({ executionId: crypto.randomUUID() });
        }
        return performance.now() - startedMs;
      });
      return Math.min(...batchMs);
    };
    const smallOutboxMs = fastestReadsOfOneDelivery(1);
    const fullOutboxMs = fastestReadsOfOneDelivery(50_000);
    // a scan of every event per read takes seconds here, not a margin's worth
    expect(fullOutboxMs).toBeLessThan(smallOutboxMs * 20 + 250);
  });
});

describe('ArvoMemoryOutbox and how many events it holds', () => {
  /** Commits one event per commit and returns their identifiers in commit order. */
  const commitEventsOneByOne = (outbox: ArvoMemoryOutbox, eventCount: number) =>
    Array.from({ length: eventCount }, () => {
      const event = buildEventRecord();
      outbox.commitEvents({ events: [event] });
      return event;
    });

  /** Whether the outbox still holds an event. */
  const holds = (
    outbox: ArvoMemoryOutbox,
    event: { readonly id: string; readonly triggeringEventId: string },
  ) =>
    outbox
      .readCommittedEvents({ triggeringEventId: event.triggeringEventId })
      .some((committedEvent) => committedEvent.id === event.id);

  it('drops the event seen longest ago to make room for a commit', () => {
    const outbox = new ArvoMemoryOutbox({ maxEvents: 3 });
    const [firstEvent, secondEvent, thirdEvent] = commitEventsOneByOne(
      outbox,
      3,
    );
    if (!firstEvent || !secondEvent || !thirdEvent)
      throw new Error('three events were committed');
    outbox.markEventsSeen([secondEvent.id]);
    outbox.markEventsSeen([firstEvent.id]);
    const newEvent = buildEventRecord();
    outbox.commitEvents({ events: [newEvent] });
    expect(holds(outbox, secondEvent)).toBe(false);
    expect(holds(outbox, firstEvent)).toBe(true);
    expect(holds(outbox, thirdEvent)).toBe(true);
    expect(holds(outbox, newEvent)).toBe(true);
  });

  it('drops no more seen events than a commit needs room for', () => {
    const outbox = new ArvoMemoryOutbox({ maxEvents: 3 });
    const heldEvents = commitEventsOneByOne(outbox, 3);
    outbox.markEventsSeen(heldEvents.map((event) => event.id));
    outbox.commitEvents({ events: [buildEventRecord()] });
    expect(heldEvents.map((event) => holds(outbox, event))).toEqual([
      false,
      true,
      true,
    ]);
  });

  it('throws on a commit with no room where every event held is unseen, having written nothing', () => {
    const outbox = new ArvoMemoryOutbox({ maxEvents: 2 });
    const heldEvents = commitEventsOneByOne(outbox, 2);
    const executionId = crypto.randomUUID();
    expect(() =>
      outbox.commitStateAndEvents(
        buildStateCommit({
          executionId,
          casVersion: 0,
          events: [buildEventRecord({ executionId })],
        }),
      ),
    ).toThrow(
      'ArvoMemoryOutbox cannot commit 1 more event: it holds 2 unseen of the 2 it may hold, and only seen events are dropped to make room. Send what it holds and mark it seen, or build it with a larger maxEvents.',
    );
    expect(outbox.readLatestState(executionId)).toBeNull();
    expect(outbox.readCommittedEvents({ executionId })).toEqual([]);
    expect(heldEvents.map((event) => holds(outbox, event))).toEqual([
      true,
      true,
    ]);
  });

  it('throws on a commit that needs more room than every seen event frees, dropping none', () => {
    const outbox = new ArvoMemoryOutbox({ maxEvents: 3 });
    const heldEvents = commitEventsOneByOne(outbox, 3);
    outbox.markEventsSeen(heldEvents.slice(0, 1).map((event) => event.id));
    expect(() =>
      outbox.commitEvents({ events: [buildEventRecord(), buildEventRecord()] }),
    ).toThrow(
      'cannot commit 2 more events: it holds 2 unseen of the 3 it may hold',
    );
    expect(heldEvents.map((event) => holds(outbox, event))).toEqual([
      true,
      true,
      true,
    ]);
  });

  it('counts an event already held, or repeated in one commit, once', () => {
    const outbox = new ArvoMemoryOutbox({ maxEvents: 2 });
    const [heldEvent] = commitEventsOneByOne(outbox, 1);
    if (!heldEvent) throw new Error('one event was committed');
    const newEvent = buildEventRecord();
    expect(() =>
      outbox.commitEvents({ events: [heldEvent, newEvent, { ...newEvent }] }),
    ).not.toThrow();
    expect(holds(outbox, newEvent)).toBe(true);
  });

  it('stores anew an event committed again after it was dropped', () => {
    const outbox = new ArvoMemoryOutbox({ maxEvents: 1 });
    const [droppedEvent] = commitEventsOneByOne(outbox, 1);
    if (!droppedEvent) throw new Error('one event was committed');
    outbox.markEventsSeen([droppedEvent.id]);
    const eventsTakingItsRoom = commitEventsOneByOne(outbox, 1);
    outbox.markEventsSeen(eventsTakingItsRoom.map((event) => event.id));
    outbox.commitEvents({ events: [droppedEvent] });
    expect(
      outbox.readCommittedEvents({
        triggeringEventId: droppedEvent.triggeringEventId,
      }),
    ).toMatchObject([{ id: droppedEvent.id, seen: false }]);
  });

  it('holds its own default number of events where none is given', () => {
    const outbox = new ArvoMemoryOutbox();
    outbox.commitEvents({
      events: Array.from({ length: 10_000 }, () => buildEventRecord()),
    });
    expect(() => outbox.commitEvents({ events: [buildEventRecord()] })).toThrow(
      'it holds 10000 unseen of the 10000 it may hold',
    );
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'refuses to be built to hold %s events',
    (maxEvents) => {
      expect(() => new ArvoMemoryOutbox({ maxEvents })).toThrow(
        `ArvoMemoryOutbox cannot be built with maxEvents ${maxEvents}; it must be a whole number greater than zero.`,
      );
    },
  );
});
