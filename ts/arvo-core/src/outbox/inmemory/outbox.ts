import type { IArvoOutbox } from '../../ArvoOutbox/interface.js';
import { ArvoOutboxLifecycle } from '../../ArvoOutbox/lifecycle.js';
import type {
  ArvoOutboxCapacity,
  ArvoOutboxCapacityRequest,
  ArvoOutboxCapacityStatus,
} from '../../ArvoOutbox/types/capacity.js';
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
import { refusalFor } from '../helpers/refusal-for.js';
import { refuseInvalidListing } from '../helpers/refuse-invalid-listing.js';
import { bufferCapacity, isDrained } from './helpers/buffer-capacity.js';
import { checkOptions } from './helpers/check-options.js';
import { copyEventRecord } from './helpers/copy-event-record.js';
import {
  addToIndex,
  type KeyedIndex,
  removeFromIndex,
} from './helpers/keyed-index.js';
import {
  type ArvoMemoryOutboxResolvedOptions,
  resolveOptions,
} from './helpers/resolve-options.js';
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
  /** Whether each buffer has held more than its size and not yet drained. */
  readonly tolerating: { events: boolean; states: boolean };
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
  tolerating: { events: false, states: false },
});

/** Every capacity status, worst last. */
const CAPACITY_STATUSES_BY_SEVERITY: readonly ArvoOutboxCapacityStatus[] =
  Object.freeze(['available', 'tolerating', 'exhausted']);

/** The worse of two statuses. */
const worseStatus = (
  firstStatus: ArvoOutboxCapacityStatus,
  secondStatus: ArvoOutboxCapacityStatus,
): ArvoOutboxCapacityStatus =>
  CAPACITY_STATUSES_BY_SEVERITY.indexOf(firstStatus) >=
  CAPACITY_STATUSES_BY_SEVERITY.indexOf(secondStatus)
    ? firstStatus
    : secondStatus;

/**
 * An outbox that holds everything in process memory, and loses all of it
 * when the process ends.
 *
 * For tests, and for a single process that can afford to lose its state and
 * unsent events on a restart. Open it before use and close it after: every
 * operation throws before it is opened and once it is closed, and closing
 * frees everything it holds. Every operation answers directly, and nothing
 * it is given or hands back shares memory with what it holds.
 *
 * It keeps each execution's latest state, and at most `options.buffers.events.size`
 * event records, making room by dropping the events seen longest ago and
 * never an unseen one; where only unseen events are held, a commit throws.
 * Landing times and leases go by `options.clock`; where it goes back, a
 * commit is stamped no earlier than the one before.
 *
 * @example
 * ```typescript
 * const outbox = new ArvoMemoryOutbox();
 * await outbox.open();
 * const outcome = outbox.commitStateAndEvents(commit);
 * const latestState = outbox.readLatestState(commit.executionId);
 * await outbox.close();
 * ```
 */
export class ArvoMemoryOutbox implements IArvoOutbox {
  private readonly options: ArvoMemoryOutboxResolvedOptions;
  private readonly lifecycle = new ArvoOutboxLifecycle<MemoryStore>(
    'ArvoMemoryOutbox',
  );

  /**
   * @param options - How it tells the time, how much it holds, and how long it keeps it. See {@link ArvoMemoryOutboxOptions}.
   * @throws {ArvoMemoryOutboxValidationError} Where the options break any rule. It names every problem.
   */
  constructor(options: ArvoMemoryOutboxOptions = {}) {
    this.options = resolveOptions(checkOptions(options));
  }

  /**
   * Opens the outbox, empty. Opening it again does nothing.
   *
   * @throws Where it has been closed: build a new one instead.
   */
  async open(): Promise<void> {
    await this.lifecycle.open(createMemoryStore);
  }

  /**
   * Closes the outbox and frees everything it holds. Closing it again does
   * nothing, and every operation throws once it is closed.
   */
  async close(): Promise<void> {
    await this.lifecycle.close(() => undefined);
  }

  // Every operation below is synchronous, so no other call can run between
  // its checks and its writes; never make one async. Every step that can
  // throw runs before the first write.

  readLatestState(executionId: string): JSONObject | null {
    const store = this.lifecycle.resourcesFor('readLatestState');
    const storedState = store.latestStateByExecution.get(executionId);
    return storedState ? structuredClone(storedState.state) : null;
  }

  commitStateAndEvents(param: ArvoOutboxStateCommit): ArvoOutboxCommitOutcome {
    const store = this.lifecycle.resourcesFor('commitStateAndEvents');
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
    this.updateTolerating(store);
    return { committed: true };
  }

  commitEvents(param: ArvoOutboxEventsCommit): void {
    const store = this.lifecycle.resourcesFor('commitEvents');
    const newEventRecords = this.withoutHeldEvents(store, param.events);
    const droppedEventCount = this.countEventsToDrop(
      store,
      newEventRecords.length,
    );
    const landing = this.stampLanding(store);
    this.dropSeenEvents(store, droppedEventCount);
    this.storeEvents(store, newEventRecords, landing);
    this.updateTolerating(store);
  }

  readCommittedEvents(
    filter: ArvoOutboxEventsFilter,
  ): readonly ArvoOutboxCommittedEventRecord[] {
    const store = this.lifecycle.resourcesFor('readCommittedEvents');
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
    const store = this.lifecycle.resourcesFor('listUnseenEvents');
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
    const store = this.lifecycle.resourcesFor('markEventsSeen');
    for (const eventId of eventIds) {
      const storedEvent = store.unseenEventsById.get(eventId);
      if (storedEvent === undefined) continue;
      storedEvent.seen = true;
      store.unseenEventsById.delete(eventId);
      store.seenEventsById.set(eventId, storedEvent);
    }
  }

  capacity(request: ArvoOutboxCapacityRequest): ArvoOutboxCapacity {
    const store = this.lifecycle.resourcesFor('capacity');
    const events = bufferCapacity({
      held: store.eventsById.size + request.events,
      buffer: this.options.buffers.events,
      tolerating: store.tolerating.events,
    });
    const states = bufferCapacity({
      held:
        store.latestStateByExecution.size +
        (request.state?.casVersion === 0 ? 1 : 0),
      buffer: this.options.buffers.states,
      tolerating: store.tolerating.states,
    });
    return {
      status: worseStatus(events.status, states.status),
      buffers: { events, states },
    };
  }

  /**
   * Sets each buffer's steady flag where it holds more than its size, and
   * clears it once drained. Called after everything that changes what is held.
   */
  private updateTolerating(store: MemoryStore): void {
    const eventsHeld = store.eventsById.size;
    const statesHeld = store.latestStateByExecution.size;
    const { events, states } = this.options.buffers;
    if (eventsHeld > events.size) store.tolerating.events = true;
    else if (isDrained(eventsHeld, events)) store.tolerating.events = false;
    if (statesHeld > states.size) store.tolerating.states = true;
    else if (isDrained(statesHeld, states)) store.tolerating.states = false;
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
      store.eventsById.size + newEventCount - this.options.buffers.events.size,
    );
    if (droppedEventCount > store.seenEventsById.size) {
      throw new Error(
        `ArvoMemoryOutbox cannot commit ${newEventCount} more ${newEventCount === 1 ? 'event' : 'events'}: it holds ${store.unseenEventsById.size} unseen of the ${this.options.buffers.events.size} it may hold, and only seen events are dropped to make room. Send what it holds and mark it seen, or build it with a larger buffers.events.size.`,
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
    const clockTime = this.options.clock();
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
