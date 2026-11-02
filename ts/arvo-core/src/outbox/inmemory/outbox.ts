import { ARVO_TERMINAL_LIFECYCLES } from '../../ArvoEventHandler/state/types.js';
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
import type {
  ArvoMemoryOutboxBuffer,
  ArvoMemoryOutboxOptions,
} from './types.js';

/** An execution's latest state, with the fields committed beside it. */
type StoredState = Omit<ArvoOutboxStateCommit, 'events'>;

/** One committed event record, with what the outbox set on it. */
type StoredEvent = {
  readonly eventRecord: ArvoOutboxEventRecord;
  readonly committedAt: string;
  readonly committedAtMs: number;
  seen: boolean;
  /** When it was marked seen; never, while unseen. */
  seenAtMs: number;
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
  // insertion order is the order seen, so the front is what is swept first
  readonly seenEventsById: Map<string, StoredEvent>;
  // each terminal state's last commit time; insertion order is last-commit order
  readonly lastCommitMsByTerminalExecution: Map<string, number>;
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
  lastCommitMsByTerminalExecution: new Map(),
  latestLandedAtMs: Number.NEGATIVE_INFINITY,
  tolerating: { events: false, states: false },
});

/** Every capacity status, worst last. */
const CAPACITY_STATUSES_BY_SEVERITY: readonly ArvoOutboxCapacityStatus[] =
  Object.freeze(['available', 'tolerating', 'exhausted']);

/** The worst of the statuses given, `available` where none is worse. */
const worstStatus = (
  ...capacityStatuses: readonly ArvoOutboxCapacityStatus[]
): ArvoOutboxCapacityStatus =>
  capacityStatuses.reduce<ArvoOutboxCapacityStatus>(
    (worstSoFar, capacityStatus) =>
      CAPACITY_STATUSES_BY_SEVERITY.indexOf(capacityStatus) >
      CAPACITY_STATUSES_BY_SEVERITY.indexOf(worstSoFar)
        ? capacityStatus
        : worstSoFar,
    'available',
  );

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
 * It keeps each execution's latest state, and holds events, seen or not, and
 * states each in a buffer of `options.buffers`. Past a buffer's size it
 * answers its capacity as `tolerating`; a commit that would take a buffer
 * past its limit is refused as `capacity_exhausted`, writing nothing. The
 * buffers count events and states, not the memory they take.
 *
 * While open, it sweeps on a timer that does not keep the process running:
 * events seen longer ago than `options.retentionMs.seenEvents`, and states
 * at `success`, `error`, `cancelled` or `failure` last committed longer ago
 * than `options.retentionMs.terminalStates`, are deleted. Make each
 * retention longer than your queue may take to deliver an event again.
 *
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
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

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
    // a close that overtook this opening leaves nothing to sweep
    if (
      this.sweepTimer !== null ||
      !this.lifecycle.tryResourcesFor('open').ok
    ) {
      return;
    }
    this.sweepTimer = setInterval(
      () => this.sweep(),
      this.options.sweepIntervalMs,
    );
    this.sweepTimer.unref();
  }

  /**
   * Closes the outbox and frees everything it holds. Closing it again does
   * nothing, and every operation throws once it is closed.
   */
  async close(): Promise<void> {
    if (this.sweepTimer !== null) clearInterval(this.sweepTimer);
    this.sweepTimer = null;
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
    const terminalLifecycles: readonly string[] = ARVO_TERMINAL_LIFECYCLES;
    const isTerminal = terminalLifecycles.includes(param.lifecycle);
    const addedStateCount = store.latestStateByExecution.has(param.executionId)
      ? 0
      : 1;
    if (
      this.wouldExhaust({
        store,
        addedEventCount: newEventRecords.length,
        addedStateCount,
      })
    ) {
      return { committed: false, refusal: 'capacity_exhausted' };
    }
    const landing = this.stampLanding(store);
    store.latestStateByExecution.set(param.executionId, {
      executionId: param.executionId,
      casVersion: param.casVersion,
      subject: param.subject,
      source: param.source,
      version: param.version,
      lifecycle: param.lifecycle,
      state,
    });
    store.lastCommitMsByTerminalExecution.delete(param.executionId);
    if (isTerminal) {
      store.lastCommitMsByTerminalExecution.set(
        param.executionId,
        landing.committedAtMs,
      );
    }
    this.storeEvents(store, newEventRecords, landing);
    this.updateTolerating(store);
    return { committed: true };
  }

  commitEvents(param: ArvoOutboxEventsCommit): ArvoOutboxCommitOutcome {
    const store = this.lifecycle.resourcesFor('commitEvents');
    const newEventRecords = this.withoutHeldEvents(store, param.events);
    if (
      this.wouldExhaust({
        store,
        addedEventCount: newEventRecords.length,
        addedStateCount: 0,
      })
    ) {
      return { committed: false, refusal: 'capacity_exhausted' };
    }
    const landing = this.stampLanding(store);
    this.storeEvents(store, newEventRecords, landing);
    this.updateTolerating(store);
    return { committed: true };
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
      if (unseenEvents.length >= param.maxCount) break;
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
    const seenAtMs = this.readClockMs();
    for (const eventId of eventIds) {
      const storedEvent = store.unseenEventsById.get(eventId);
      if (storedEvent === undefined) continue;
      storedEvent.seen = true;
      storedEvent.seenAtMs = seenAtMs;
      store.unseenEventsById.delete(eventId);
      store.seenEventsById.set(eventId, storedEvent);
    }
  }

  capacity(request: ArvoOutboxCapacityRequest): ArvoOutboxCapacity {
    const store = this.lifecycle.resourcesFor('capacity');
    const eventsCapacity = bufferCapacity({
      heldCount: store.eventsById.size + request.events,
      buffer: this.options.buffers.events,
      tolerating: store.tolerating.events,
    });
    const statesCapacity = bufferCapacity({
      heldCount:
        store.latestStateByExecution.size +
        (request.state?.casVersion === 0 ? 1 : 0),
      buffer: this.options.buffers.states,
      tolerating: store.tolerating.states,
    });
    return {
      status: worstStatus(eventsCapacity.status, statesCapacity.status),
      buffers: { events: eventsCapacity, states: statesCapacity },
    };
  }

  /**
   * Deletes every seen event and terminal state past its retention, oldest
   * first, stopping at the first that is not, so it does work in proportion
   * to what it deletes. Run by the timer alone.
   */
  private sweep(): void {
    // a throw from a timer would end the process, so a failed sweep only warns
    try {
      const store = this.lifecycle.resourcesFor('sweep');
      const nowMs = this.readClockMs();
      this.sweepSeenEvents(store, nowMs - this.options.retentionMs.seenEvents);
      this.sweepTerminalStates(
        store,
        nowMs - this.options.retentionMs.terminalStates,
      );
      this.updateTolerating(store);
    } catch (error_) {
      console.warn(
        'ArvoMemoryOutbox could not sweep, and will try again at its next sweep',
        error_,
      );
    }
  }

  /** Deletes every event seen at or before `seenBeforeMs`. */
  private sweepSeenEvents(store: MemoryStore, seenBeforeMs: number): void {
    for (const [eventId, storedEvent] of store.seenEventsById) {
      if (storedEvent.seenAtMs > seenBeforeMs) return;
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

  /** Deletes every terminal state last committed at or before `committedBeforeMs`, leaving its events. */
  private sweepTerminalStates(
    store: MemoryStore,
    committedBeforeMs: number,
  ): void {
    for (const [
      executionId,
      lastCommitMs,
    ] of store.lastCommitMsByTerminalExecution) {
      if (lastCommitMs > committedBeforeMs) return;
      store.lastCommitMsByTerminalExecution.delete(executionId);
      store.latestStateByExecution.delete(executionId);
    }
  }

  /**
   * Sets each buffer's steady flag where it holds more than its size, and
   * clears it once drained. Called after everything that changes what is held.
   */
  private updateTolerating(store: MemoryStore): void {
    const eventsHeld = store.eventsById.size;
    const statesHeld = store.latestStateByExecution.size;
    const { events: eventsBuffer, states: statesBuffer } = this.options.buffers;
    if (eventsHeld > eventsBuffer.size) store.tolerating.events = true;
    else if (isDrained(eventsHeld, eventsBuffer)) {
      store.tolerating.events = false;
    }
    if (statesHeld > statesBuffer.size) store.tolerating.states = true;
    else if (isDrained(statesHeld, statesBuffer)) {
      store.tolerating.states = false;
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

  /** Whether adding this much would take either buffer past its limit. */
  private wouldExhaust(param: {
    readonly store: MemoryStore;
    readonly addedEventCount: number;
    readonly addedStateCount: number;
  }): boolean {
    const { events: eventsBuffer, states: statesBuffer } = this.options.buffers;
    const isExhausted = (heldCount: number, buffer: ArvoMemoryOutboxBuffer) =>
      bufferCapacity({ heldCount, buffer, tolerating: false }).status ===
      'exhausted';
    return (
      isExhausted(
        param.store.eventsById.size + param.addedEventCount,
        eventsBuffer,
      ) ||
      isExhausted(
        param.store.latestStateByExecution.size + param.addedStateCount,
        statesBuffer,
      )
    );
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
        seenAtMs: Number.POSITIVE_INFINITY,
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
