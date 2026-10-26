import type { IArvoOutbox } from '../../ArvoOutbox/interface.js';
import type {
  ArvoOutboxCommitOutcome,
  ArvoOutboxEventsCommit,
  ArvoOutboxStateCommit,
} from '../../ArvoOutbox/types/commit.js';
import type {
  ArvoOutboxCommittedEventRecord,
  ArvoOutboxEventRecord,
} from '../../ArvoOutbox/types/event-record.js';
import type {
  ArvoOutboxEventsFilter,
  ArvoOutboxUnseenEventsParam,
} from '../../ArvoOutbox/types/read.js';
import type { JSONObject } from '../../types.js';
import { OutboxLifecycle } from '../helpers/outbox-lifecycle.js';
import { refusalFor } from '../helpers/refusal-for.js';
import { refuseInvalidListing } from '../helpers/refuse-invalid-listing.js';
import { copyEventRecord } from './helpers/copy-event-record.js';
import { defaultMaxEvents } from './helpers/defaults.js';
import {
  addToIndex,
  type KeyedIndex,
  removeFromIndex,
} from './helpers/keyed-index.js';
import type { ArvoMemoryOutboxOptions } from './types.js';

/** An execution's latest state, with the fields committed beside it. */
type StoredState = Omit<ArvoOutboxStateCommit, 'events'>;

/** One committed event record, with what the outbox set on it. */
type StoredEvent = {
  readonly eventRecord: ArvoOutboxEventRecord;
  readonly committedAt: string;
  readonly committedAtMs: number;
  seen: boolean;
  /** When the claim on it lapses; no later than now where unclaimed. */
  leasedUntilMs: number;
};

/** When one commit landed, as stamped and as compared. */
type Landing = Pick<StoredEvent, 'committedAt' | 'committedAtMs'>;

/** Everything an open outbox holds, dropped whole when it is closed. */
type MemoryStore = {
  readonly latestStateByExecution: Map<string, StoredState>;
  readonly eventsById: Map<string, StoredEvent>;
  readonly eventsByExecution: KeyedIndex<StoredEvent>;
  readonly eventsByTriggeringEvent: KeyedIndex<StoredEvent>;
  // insertion order is landing order, because every landing is stamped no earlier than the last
  readonly unseenEventsById: Map<string, StoredEvent>;
  // insertion order is the order seen, so the front is what is dropped first
  readonly seenEventsById: Map<string, StoredEvent>;
  latestLandedAtMs: number;
};

/** An empty store. */
const createMemoryStore = (): MemoryStore => ({
  latestStateByExecution: new Map(),
  eventsById: new Map(),
  eventsByExecution: new Map(),
  eventsByTriggeringEvent: new Map(),
  unseenEventsById: new Map(),
  seenEventsById: new Map(),
  latestLandedAtMs: Number.NEGATIVE_INFINITY,
});

/**
 * An outbox that holds everything in process memory, and loses all of it
 * when the process ends.
 *
 * For tests, and for a single process that can afford to lose its state and
 * unsent events on a restart. It meets every rule of {@link IArvoOutbox},
 * answers every operation directly, never through a promise, and so
 * answers overlapping callers as if each ran alone. Nothing it is given or
 * hands back shares memory with what it holds, and every read goes through
 * an index, so a call does the same work however much it holds.
 *
 * Open it before use and close it after: every operation throws before it
 * is opened and once it is closed, and closing frees everything it holds.
 *
 * It keeps each execution's latest state, and at most `options.maxEvents`
 * event records, making room by dropping the events seen longest ago and
 * never an unseen one. It honours a lease asked for when listing unseen
 * events, by its own clock. Landing times come from `options.clock`; where that
 * clock goes back, a commit is stamped with the latest time already
 * stamped, so unseen events are always listed in the order committed.
 *
 * @example
 * ```typescript
 * const outbox = new ArvoMemoryOutbox();
 * outbox.open();
 * const outcome = outbox.commitStateAndEvents(commit);
 * const latestState = outbox.readLatestState(commit.executionId);
 * outbox.close();
 * ```
 */
export class ArvoMemoryOutbox implements IArvoOutbox {
  private readonly clock: () => Date;
  private readonly maxEvents: number;
  private readonly lifecycle = new OutboxLifecycle<MemoryStore>(
    'ArvoMemoryOutbox',
  );

  /**
   * @param options - How it tells the time and how much it holds. See {@link ArvoMemoryOutboxOptions}.
   * @throws {RangeError} Where `options.maxEvents` is not a whole number greater than zero.
   */
  constructor(options: ArvoMemoryOutboxOptions = {}) {
    const maxEvents = options.maxEvents ?? defaultMaxEvents;
    if (!Number.isInteger(maxEvents) || maxEvents <= 0) {
      throw new RangeError(
        `ArvoMemoryOutbox cannot be built with maxEvents ${maxEvents}; it must be a whole number greater than zero.`,
      );
    }
    this.maxEvents = maxEvents;
    this.clock = options.clock ?? (() => new Date());
  }

  /**
   * Opens the outbox, empty. Opening it again does nothing.
   *
   * @throws Where it has been closed: build a new one instead.
   */
  open(): void {
    this.lifecycle.open(createMemoryStore);
  }

  /**
   * Closes the outbox and frees everything it holds. Closing it again does
   * nothing, and every operation throws once it is closed.
   */
  close(): void {
    this.lifecycle.close(() => undefined);
  }

  // Every operation below is synchronous, so no other call can run between
  // its checks and its writes; never make one async. Every step that can
  // throw runs before the first write.

  readLatestState(executionId: string): JSONObject | null {
    const store = this.lifecycle.held('readLatestState');
    const storedState = store.latestStateByExecution.get(executionId);
    return storedState ? structuredClone(storedState.state) : null;
  }

  commitStateAndEvents(param: ArvoOutboxStateCommit): ArvoOutboxCommitOutcome {
    const store = this.lifecycle.held('commitStateAndEvents');
    const state = structuredClone(param.state);
    const newEventRecords = this.withoutHeldEvents(store, param.events);
    const refusal = refusalFor({
      casVersion: param.casVersion,
      storedCasVersion: store.latestStateByExecution.get(param.executionId)
        ?.casVersion,
    });
    if (refusal !== null) return { committed: false, refusal };
    const droppedEventCount = this.countEventsToDrop(
      store,
      newEventRecords.length,
    );
    const landing = this.stampLanding(store);
    this.dropSeenEvents(store, droppedEventCount);
    store.latestStateByExecution.set(param.executionId, {
      executionId: param.executionId,
      casVersion: param.casVersion,
      subject: param.subject,
      source: param.source,
      version: param.version,
      lifecycle: param.lifecycle,
      state,
    });
    this.storeEvents(store, newEventRecords, landing);
    return { committed: true };
  }

  commitEvents(param: ArvoOutboxEventsCommit): void {
    const store = this.lifecycle.held('commitEvents');
    const newEventRecords = this.withoutHeldEvents(store, param.events);
    const droppedEventCount = this.countEventsToDrop(
      store,
      newEventRecords.length,
    );
    const landing = this.stampLanding(store);
    this.dropSeenEvents(store, droppedEventCount);
    this.storeEvents(store, newEventRecords, landing);
  }

  readCommittedEvents(
    filter: ArvoOutboxEventsFilter,
  ): readonly ArvoOutboxCommittedEventRecord[] {
    const store = this.lifecycle.held('readCommittedEvents');
    if (!('triggeringEventId' in filter)) {
      return [
        ...(store.eventsByExecution.get(filter.executionId)?.values() ?? []),
      ].map(toCommittedEventRecord);
    }
    const deliveryEvents = [
      ...(store.eventsByTriggeringEvent
        .get(filter.triggeringEventId)
        ?.values() ?? []),
    ];
    return (
      'executionId' in filter
        ? deliveryEvents.filter(
            (storedEvent) =>
              storedEvent.eventRecord.executionId === filter.executionId,
          )
        : deliveryEvents
    ).map(toCommittedEventRecord);
  }

  listUnseenEvents(
    param: ArvoOutboxUnseenEventsParam,
  ): readonly ArvoOutboxCommittedEventRecord[] {
    const store = this.lifecycle.held('listUnseenEvents');
    refuseInvalidListing('ArvoMemoryOutbox', param);
    const nowMs = this.readClockMs();
    const cutOffMs = nowMs - param.olderThanMs;
    const unseenEvents: ArvoOutboxCommittedEventRecord[] = [];
    // a leased event is skipped, not removed, so landing order survives its lapse
    for (const storedEvent of store.unseenEventsById.values()) {
      if (unseenEvents.length >= param.atMost) break;
      if (storedEvent.committedAtMs > cutOffMs) break;
      if (storedEvent.leasedUntilMs > nowMs) continue;
      if (param.leaseMs !== undefined) {
        storedEvent.leasedUntilMs = nowMs + param.leaseMs;
      }
      unseenEvents.push(toCommittedEventRecord(storedEvent));
    }
    return unseenEvents;
  }

  markEventsSeen(eventIds: readonly string[]): void {
    const store = this.lifecycle.held('markEventsSeen');
    for (const eventId of eventIds) {
      const storedEvent = store.unseenEventsById.get(eventId);
      if (storedEvent === undefined) continue;
      storedEvent.seen = true;
      store.unseenEventsById.delete(eventId);
      store.seenEventsById.set(eventId, storedEvent);
    }
  }

  /** Copies of the records not already held, each identifier once. */
  private withoutHeldEvents(
    store: MemoryStore,
    eventRecords: readonly ArvoOutboxEventRecord[],
  ): ArvoOutboxEventRecord[] {
    const newEventRecords = new Map<string, ArvoOutboxEventRecord>();
    for (const eventRecord of eventRecords) {
      if (store.eventsById.has(eventRecord.id)) continue;
      if (newEventRecords.has(eventRecord.id)) continue;
      newEventRecords.set(eventRecord.id, copyEventRecord(eventRecord));
    }
    return [...newEventRecords.values()];
  }

  /** How many seen events must go to make room, refusing where too few are seen. */
  private countEventsToDrop(store: MemoryStore, newEventCount: number): number {
    const droppedEventCount = Math.max(
      0,
      store.eventsById.size + newEventCount - this.maxEvents,
    );
    if (droppedEventCount > store.seenEventsById.size) {
      throw new Error(
        `ArvoMemoryOutbox cannot commit ${newEventCount} more ${newEventCount === 1 ? 'event' : 'events'}: it holds ${store.unseenEventsById.size} unseen of the ${this.maxEvents} it may hold, and only seen events are dropped to make room. Send what it holds and mark it seen, or build it with a larger maxEvents.`,
      );
    }
    return droppedEventCount;
  }

  /** Forgets the events seen longest ago. */
  private dropSeenEvents(store: MemoryStore, droppedEventCount: number): void {
    let remainingDropCount = droppedEventCount;
    for (const [eventId, storedEvent] of store.seenEventsById) {
      if (remainingDropCount === 0) break;
      remainingDropCount -= 1;
      store.seenEventsById.delete(eventId);
      store.eventsById.delete(eventId);
      removeFromIndex(
        store.eventsByExecution,
        storedEvent.eventRecord.executionId,
        eventId,
      );
      removeFromIndex(
        store.eventsByTriggeringEvent,
        storedEvent.eventRecord.triggeringEventId,
        eventId,
      );
    }
  }

  /** The clock's time, refusing one that is no time at all. */
  private readClockMs(): number {
    const clockTime = this.clock();
    const clockMs = clockTime.getTime();
    if (Number.isNaN(clockMs)) {
      throw new RangeError(
        `ArvoMemoryOutbox's clock returned ${String(clockTime)}; a clock must return a valid Date.`,
      );
    }
    return clockMs;
  }

  /** One landing time for one commit, never earlier than the last. */
  private stampLanding(store: MemoryStore): Landing {
    const committedAtMs = Math.max(this.readClockMs(), store.latestLandedAtMs);
    store.latestLandedAtMs = committedAtMs;
    return {
      committedAt: new Date(committedAtMs).toISOString(),
      committedAtMs,
    };
  }

  /** Stores each new event, in order, as unseen. */
  private storeEvents(
    store: MemoryStore,
    newEventRecords: readonly ArvoOutboxEventRecord[],
    landing: Landing,
  ): void {
    for (const eventRecord of newEventRecords) {
      const storedEvent: StoredEvent = {
        eventRecord,
        ...landing,
        seen: false,
        leasedUntilMs: Number.NEGATIVE_INFINITY,
      };
      store.eventsById.set(eventRecord.id, storedEvent);
      addToIndex(
        store.eventsByExecution,
        eventRecord.executionId,
        eventRecord.id,
        storedEvent,
      );
      addToIndex(
        store.eventsByTriggeringEvent,
        eventRecord.triggeringEventId,
        eventRecord.id,
        storedEvent,
      );
      store.unseenEventsById.set(eventRecord.id, storedEvent);
    }
  }
}

/** A stored event as handed back: a copy sharing nothing with what is held. */
const toCommittedEventRecord = (
  storedEvent: StoredEvent,
): ArvoOutboxCommittedEventRecord => ({
  ...storedEvent.eventRecord,
  committedAt: storedEvent.committedAt,
  seen: storedEvent.seen,
});
