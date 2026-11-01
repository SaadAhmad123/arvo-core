import {
  type ArvoEvent,
  ArvoEventSerializer,
  type ArvoHandlerFault,
  type ArvoOutboxDriver,
  type ArvoOutboxDriverEventEntry,
  type JSONObject,
} from 'arvo-core';
import type { CatalogueData } from './catalogue.js';
import type { FakeQueue, QueuedDelivery } from './fake-queue.js';
import {
  answerFromOutside,
  dependenciesFor,
  type LatticeDispatcher,
  LOAD_CALLER,
} from './lattice.js';
import type { Ledger } from './ledger.js';

/**
 * Workers and a sweeper, driving the distributed handlers through a real
 * dispatcher and an outbox driver, as a mechanism would: deliver, commit,
 * publish, mark seen; retry what may be retried, give up what may not,
 * recover what a repeated delivery finds already done, and sweep what a
 * worker committed but never sent.
 */

/** The format a fault carries its abandonment event in. */
const WIRE = new ArvoEventSerializer({ type: 'arvoevent' });

/** How a run's sweeper looks for what workers committed and never sent. */
export type SweeperSettings = {
  readonly intervalMs: number;
  readonly olderThanMs: number;
  readonly atMost: number;
  readonly leaseMs?: number;
};

/** What a lattice run is given. */
export type LatticeRunParam = {
  readonly driver: ArvoOutboxDriver;
  readonly dispatcher: LatticeDispatcher;
  readonly catalogueData: CatalogueData;
  readonly ledger: Ledger;
  readonly queue: FakeQueue;
  readonly workerCount: number;
  readonly sweeper: SweeperSettings | null;
  /** The share of commits whose events a worker leaves for the sweeper, as if it died after committing. */
  readonly unsentShare: number;
  /** Whether a worker asks the outbox's capacity before taking on a delivery. */
  readonly askCapacityFirst: boolean;
  /** How long the run may take before it stops, finished or not. */
  readonly deadlineMs: number;
  /** Seeds the run's choices, so a run can be repeated. */
  readonly seed: number;
};

/** What a lattice run came to. */
export type LatticeRunOutcome = {
  deliveries: number;
  answeredOrders: number;
  commits: number;
  retries: number;
  givenUp: number;
  recoveries: number;
  sweptEvents: number;
  pausedForRoom: number;
  refusalsByKind: Record<string, number>;
  finished: boolean;
  elapsedMs: number;
};

/** A repeatable stream of numbers between zero and one. */
const seededRandom = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
};

/** Lets the event loop turn, so other workers and timers run. */
const yieldTurn = () => new Promise<void>((settle) => setImmediate(settle));

/** Runs the lattice until every order is answered and every committed event sent, or the deadline passes. */
export const runLattice = async (
  param: LatticeRunParam,
): Promise<LatticeRunOutcome> => {
  const random = seededRandom(param.seed);
  const startedAt = Date.now();
  const outcome: LatticeRunOutcome = {
    deliveries: 0,
    answeredOrders: 0,
    commits: 0,
    retries: 0,
    givenUp: 0,
    recoveries: 0,
    sweptEvents: 0,
    pausedForRoom: 0,
    refusalsByKind: {},
    finished: false,
    elapsedMs: 0,
  };
  const answeredEventIds = new Set<string>();
  const answeredReviewIds = new Set<string>();
  let inFlightCount = 0;
  let stopped = false;

  /** Hands events on: to the caller, to the outside, or back onto the queue. */
  const route = (events: readonly ArvoEvent[]): void => {
    for (const event of events) {
      if (event.domain !== null) {
        if (!answeredReviewIds.has(event.id)) {
          answeredReviewIds.add(event.id);
          param.queue.publish([answerFromOutside(event)]);
        }
      } else if (event.to === LOAD_CALLER) {
        if (!answeredEventIds.has(event.id)) {
          answeredEventIds.add(event.id);
          if (event.type.startsWith('evt_order_')) outcome.answeredOrders += 1;
        }
      } else {
        param.queue.publish([event]);
      }
    }
    param.ledger.recordHandedOut(events.map((event) => event.id));
  };

  /** Hands on what was read back from the outbox, then marks it seen. */
  const routeEntries = async (
    entries: readonly ArvoOutboxDriverEventEntry[],
  ): Promise<void> => {
    for (const entry of entries) {
      param.ledger.samplePayload({
        eventId: entry.record.id,
        triggeringEventId: entry.record.triggeringEventId,
        payload: entry.record.payload,
      });
    }
    route(
      entries
        .map((entry) => entry.event)
        .filter((event): event is ArvoEvent => event !== null),
    );
    await param.driver.markEventsSeen({
      eventIds: entries.map((entry) => entry.record.id),
    });
  };

  /** Sends again whatever a delivery already committed, as a repeated delivery must. */
  const recover = async (triggeringEvent: ArvoEvent): Promise<void> => {
    outcome.recoveries += 1;
    await routeEntries(
      await param.driver.readCommittedEvents({
        filter: { triggeringEventId: triggeringEvent.id },
      }),
    );
  };

  /** Counts a refusal by its kind, and puts the delivery back to run again. */
  const refuse = (kind: string, delivery: QueuedDelivery): void => {
    outcome.refusalsByKind[kind] = (outcome.refusalsByKind[kind] ?? 0) + 1;
    param.queue.redeliver(delivery);
  };

  /** Publishes and marks seen what a commit carried, or leaves it for the sweeper. */
  const afterCommit = async (events: readonly ArvoEvent[]): Promise<void> => {
    outcome.commits += 1;
    if (random() < param.unsentShare) return;
    route(events);
    await param.driver.markEventsSeen({
      eventIds: events.map((event) => event.id),
    });
  };

  /** Commits what a fault says to commit on giving up. */
  const giveUp = async (
    fault: ArvoHandlerFault,
    delivery: QueuedDelivery,
  ): Promise<void> => {
    outcome.givenUp += 1;
    const abandonmentEvent =
      fault.abandonmentEvent === null
        ? null
        : await WIRE.deserialize(fault.abandonmentEvent);
    const events = abandonmentEvent === null ? [] : [abandonmentEvent];
    if (fault.abandonmentState === null && events.length === 0) return;
    const committed =
      fault.abandonmentState === null
        ? await param.driver.tryCommitEvents({
            events,
            triggeringEvent: delivery.event,
          })
        : await param.driver.tryCommitStateAndEvents({
            state: JSON.parse(fault.abandonmentState) as JSONObject,
            events,
            triggeringEvent: delivery.event,
          });
    if (committed.ok) {
      const state =
        fault.abandonmentState === null
          ? null
          : (JSON.parse(fault.abandonmentState) as JSONObject);
      param.ledger.recordCommit({
        executionId:
          typeof state?.executionId === 'string' ? state.executionId : null,
        casVersion:
          typeof state?.casVersion === 'number' ? state.casVersion : null,
        eventIds: events.map((event) => event.id),
      });
      await afterCommit(events);
    } else if (
      committed.error.kind === 'capacity_exhausted' ||
      committed.error.kind === 'unavailable'
    ) {
      refuse(committed.error.kind, delivery);
    } else {
      await recover(delivery.event);
    }
  };

  /** One delivery, start to end. */
  const deliver = async (delivery: QueuedDelivery): Promise<void> => {
    outcome.deliveries += 1;
    if (param.askCapacityFirst) {
      const capacityResult = await param.driver.tryCapacity();
      if (capacityResult.ok && capacityResult.value.status === 'exhausted') {
        outcome.pausedForRoom += 1;
        param.queue.redeliver(delivery);
        return;
      }
    }
    const executed = await param.dispatcher.tryExecute({
      event: delivery.event,
      attempt: delivery.attempt,
      state: ({ executionId }) => param.driver.readLatestState({ executionId }),
      dependencies: dependenciesFor(param.catalogueData),
    });
    if (!executed.ok) {
      const fault = executed.error;
      if (fault.faultKind === 'record_unexpected') {
        await recover(delivery.event);
        return;
      }
      if (
        fault.retry !== null &&
        delivery.attempt + 1 <= fault.retry.maxRetryAttemptsAllowed
      ) {
        outcome.retries += 1;
        param.queue.redeliver({
          event: delivery.event,
          attempt: delivery.attempt + 1,
        });
        return;
      }
      await giveUp(fault, delivery);
      return;
    }
    if (executed.value.kind === 'discarded') {
      await recover(delivery.event);
      return;
    }
    const { state, events } = executed.value;
    const committed = await param.driver.tryCommitStateAndEvents({
      state,
      events,
      triggeringEvent: delivery.event,
    });
    if (!committed.ok) {
      refuse(committed.error.kind, delivery);
      return;
    }
    param.ledger.recordCommit({
      executionId:
        typeof state.executionId === 'string' ? state.executionId : null,
      casVersion:
        typeof state.casVersion === 'number' ? state.casVersion : null,
      eventIds: events.map((event) => event.id),
    });
    await afterCommit(events);
  };

  /** Whether every committed event has been handed out and no work is left. */
  const isSettled = (): boolean => {
    if (param.queue.waitingCount > 0 || inFlightCount > 0) return false;
    for (const eventId of param.ledger.committedEventIds) {
      if (!param.ledger.handedOutEventIds.has(eventId)) return false;
    }
    return true;
  };

  const worker = async (): Promise<void> => {
    while (!stopped) {
      const delivery = param.queue.take();
      if (delivery === undefined) {
        await yieldTurn();
        continue;
      }
      inFlightCount += 1;
      try {
        await deliver(delivery);
      } catch (error_) {
        param.ledger.recordUnexpectedThrow(
          `delivering ${delivery.event.type}`,
          error_,
        );
      } finally {
        inFlightCount -= 1;
      }
    }
  };

  const sweeper = async (settings: SweeperSettings): Promise<void> => {
    while (!stopped) {
      await new Promise((settle) => setTimeout(settle, settings.intervalMs));
      try {
        const entries = await param.driver.listUnseenEvents({
          atMost: settings.atMost,
          olderThanMs: settings.olderThanMs,
          ...(settings.leaseMs === undefined
            ? {}
            : { leaseMs: settings.leaseMs }),
        });
        param.ledger.recordListing(
          entries.map((entry) => entry.record.committedAt),
        );
        outcome.sweptEvents += entries.length;
        await routeEntries(entries);
      } catch (error_) {
        param.ledger.recordUnexpectedThrow('sweeping', error_);
      }
    }
  };

  const running = [
    ...Array.from({ length: param.workerCount }, () => worker()),
    ...(param.sweeper === null ? [] : [sweeper(param.sweeper)]),
  ];
  const deadline = startedAt + param.deadlineMs;
  while (Date.now() < deadline) {
    await new Promise((settle) => setTimeout(settle, 20));
    if (isSettled()) {
      outcome.finished = true;
      break;
    }
  }
  stopped = true;
  await Promise.all(running);
  outcome.elapsedMs = Date.now() - startedAt;
  return outcome;
};
