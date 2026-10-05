import {
  ApplicationFailure,
  activityInfo,
  heartbeat,
} from '@temporalio/activity';
import {
  ARVO_TERMINAL_LIFECYCLES,
  type ArvoEvent,
  ArvoEventSerializer,
  type ArvoHandlerFault,
  type JSONObject,
} from 'arvo-core';
import type { Pool } from 'pg';
import { catalogueFor } from '../shared/catalogue.js';
import { needsAPerson, whyFor } from '../shared/needs-a-person.js';
import { type Destination, destinationFor } from '../shared/routing.js';
import type { CommittedEvent, RecordStore } from '../shared/store.js';
import { queueFor } from './queues.js';

/**
 * One execution of one handler, as a Temporal activity.
 *
 * This is where ADR-006's five obligations are met for this mechanism,
 * and the whole of what Temporal is told about Arvo. Everything above it
 * — the workflow — knows only that something ran, what it produced, and
 * where each of those has to go; everything below it is the handler,
 * which knows nothing about Temporal at all.
 *
 * Four things here are the obligations rather than conveniences:
 *
 * The record is read on every invocation and never carried forward, so a
 * retry sees whatever the store says now. Temporal counts attempts from
 * one and Arvo from zero, and the translation happens once, here.
 *
 * What is published is read back out of the outbox rather than taken
 * from what the handler returned. On the ordinary path those are the
 * same bytes; on a repeat they are not, because the handler will not
 * produce them a second time — and the bytes that were committed are
 * the ones that have to arrive.
 *
 * A fault decides whether another attempt happens. Where one is in
 * prospect this throws so Temporal retries, with the delay the fault
 * asked for; where none is, it does not throw at all, which is the only
 * way to be sure a mechanism's own retry policy cannot overrule the
 * handler.
 *
 * And a redelivery is not a failure. ADR-008 names the case a mechanism
 * is most likely to get wrong — an opening event for an execution that
 * already exists — and treating it as a failure would publish a handler
 * error for work that had already succeeded.
 */

/** The format the outbox holds an event in, and the format an activity is given one in. */
const WIRE = new ArvoEventSerializer({ type: 'arvoevent' });

/** What a mechanism has to do with one event the store committed. */
export type TemporalDispatch =
  /** Start an execution, which is this workflow on this queue. */
  | {
      readonly kind: 'opens';
      readonly executionId: string;
      readonly taskQueue: string;
      readonly contractType: string;
      readonly eventId: string;
      readonly subject: string;
      readonly payload: string;
    }
  /** Hand it to an execution already under way, which is this workflow. */
  | {
      readonly kind: 'answers';
      readonly executionId: string;
      readonly eventId: string;
      readonly payload: string;
    };

/** What one execution did, in the only terms the workflow needs. */
export type ExecutionReport = {
  /**
   * What happened to the record.
   *
   * `committed` wrote one. `recovered` found this event had already been
   * executed and is republishing what that execution committed.
   * `discarded` found nothing to do at all. `abandoned` gave up, having
   * committed the record and the event the fault carried.
   */
  readonly outcome: 'committed' | 'recovered' | 'discarded' | 'abandoned';
  /** Where the execution now rests, or `null` where nothing was committed. */
  readonly lifecycle: string | null;
  /** Whether it accepts nothing further, so the workflow may close. */
  readonly finished: boolean;
  /** Everything to send, and where. Read from the outbox, not from the handler. */
  readonly dispatch: readonly TemporalDispatch[];
  /** What a person reading a history would want to know. */
  readonly note: string | null;
};

/** What the activities reach, built once per worker and handed down. */
export type ActivityScope = {
  readonly pool: Pool;
  readonly store: RecordStore;
};

/** Whether a lifecycle accepts nothing further. */
const restsForGood = (lifecycle: string | null): boolean =>
  lifecycle !== null &&
  (ARVO_TERMINAL_LIFECYCLES as readonly string[]).includes(lifecycle);

/** Where a record says it rests, read off the document a handler wrote. */
const lifecycleOf = (record: JSONObject): string | null => {
  const rests = record.lifecycle;
  return typeof rests === 'string' ? rests : null;
};

/**
 * Everything one execution committed, turned into what to do with it.
 *
 * Anything that left the lattice or was addressed outside is dealt with
 * here and left out of what comes back: the workflow is given only what
 * it has to do in Temporal, so a history reads as a list of deliveries
 * rather than a list of decisions.
 */
const dispatchFor = async (
  scope: ActivityScope,
  committed: readonly CommittedEvent[],
): Promise<readonly TemporalDispatch[]> => {
  const dispatch: TemporalDispatch[] = [];
  const dealtWith: string[] = [];

  for (const one of committed) {
    const event = await WIRE.deserialize(one.payload);
    const where: Destination = await destinationFor(event);

    const why = whyFor(where);
    if (why !== null) {
      await needsAPerson(scope.pool, {
        event,
        payload: one.payload,
        why,
        executionId: one.executionId,
        message: null,
      });
      dealtWith.push(one.eventId);
      continue;
    }

    if (where.kind === 'opens') {
      dispatch.push({
        kind: 'opens',
        executionId: where.executionId,
        taskQueue: queueFor(where.handler.contracts.self.type),
        contractType: where.handler.contracts.self.type,
        eventId: one.eventId,
        subject: one.subject,
        payload: one.payload,
      });
      continue;
    }

    if (where.kind === 'answers') {
      dispatch.push({
        kind: 'answers',
        executionId: where.executionId,
        eventId: one.eventId,
        payload: one.payload,
      });
    }
  }

  // Published, in the sense that matters: nothing is going to send them
  // anywhere, and leaving them outstanding would have the recovery
  // publisher offer them for ever.
  await scope.store.markPublished(dealtWith);

  return dispatch;
};

/** What to report where this event's execution had already happened. */
const republish = async (
  scope: ActivityScope,
  executionId: string,
  triggering: ArvoEvent,
  note: string,
): Promise<ExecutionReport> => {
  const committed = await scope.store.committedFor(executionId, triggering.id);
  const record = await scope.store.readRecord(executionId);
  const lifecycle = record === null ? null : lifecycleOf(record as JSONObject);

  return {
    outcome: committed.length === 0 ? 'discarded' : 'recovered',
    lifecycle,
    finished: restsForGood(lifecycle),
    dispatch: await dispatchFor(scope, committed),
    note,
  };
};

/**
 * What a fault that nothing will retry leaves behind.
 *
 * ADR-008 gives a mechanism exactly what the fault carries and nothing
 * of its own, and a fault carries one of three things: both halves of an
 * abandonment, the event alone, or neither. Each is acted on as it
 * stands.
 */
const giveUp = async (
  scope: ActivityScope,
  fault: ArvoHandlerFault,
  triggering: ArvoEvent,
  executionId: string,
): Promise<ExecutionReport> => {
  // Both halves. Committed together under the outbox like any other
  // record, and composed by nothing here.
  if (fault.abandonmentState !== null) {
    const record = JSON.parse(fault.abandonmentState) as JSONObject;
    const event =
      fault.abandonmentEvent === null
        ? null
        : await WIRE.deserialize(fault.abandonmentEvent);

    const outcome = await scope.store.commit({
      record,
      events: event === null ? [] : [event],
    });

    if (!outcome.committed) {
      return republish(
        scope,
        executionId,
        triggering,
        `abandonment was already committed: ${outcome.because}`,
      );
    }

    const committed = await scope.store.committedFor(
      executionId,
      triggering.id,
    );
    return {
      outcome: 'abandoned',
      lifecycle: lifecycleOf(record),
      finished: restsForGood(lifecycleOf(record)),
      dispatch: await dispatchFor(scope, committed),
      note: `${fault.faultKind}: ${fault.message}`,
    };
  }

  // The event alone, there being no record to carry forward — a failure
  // that happened before one could be read. There is then nothing for
  // the event to be preserved *together with*, which is the whole of
  // what the outbox is for, so it is sent directly and recorded where a
  // person can see that it was.
  if (fault.abandonmentEvent !== null) {
    const event = await WIRE.deserialize(fault.abandonmentEvent);
    const where = await destinationFor(event);

    if (where.kind === 'answers') {
      return {
        outcome: 'abandoned',
        lifecycle: null,
        finished: true,
        dispatch: [
          {
            kind: 'answers',
            executionId: where.executionId,
            eventId: event.id,
            payload: fault.abandonmentEvent,
          },
        ],
        note: `${fault.faultKind}: ${fault.message}`,
      };
    }

    await needsAPerson(scope.pool, {
      event,
      payload: fault.abandonmentEvent,
      why: 'nothing_will_retry',
      executionId: fault.executionId,
      message: `${fault.faultKind}: ${fault.message}`,
    });

    return {
      outcome: 'abandoned',
      lifecycle: null,
      finished: true,
      dispatch: [],
      note: `${fault.faultKind}: ${fault.message}`,
    };
  }

  // Neither. The execution answered its caller once already and rests
  // where it rests, so there is nothing to commit and nobody to tell.
  await needsAPerson(scope.pool, {
    event: triggering,
    payload: await WIRE.serialize(triggering),
    why: 'nothing_will_retry',
    executionId: fault.executionId,
    message: `${fault.faultKind}: ${fault.message}`,
  });

  return {
    outcome: 'discarded',
    lifecycle: null,
    finished: true,
    dispatch: [],
    note: `${fault.faultKind}: ${fault.message}`,
  };
};

/**
 * Everything Temporal may run, bound to what this worker reaches.
 *
 * Built from the worker's own scope rather than from module state, so
 * two workers in one process do not share a pool and a worker shutting
 * down takes its own connections with it.
 *
 * @param scope - The store and the pool behind it.
 */
export const createActivities = (scope: ActivityScope) => ({
  /**
   * Runs one execution and commits what it produced.
   *
   * @param payload - The triggering event, in the event's own format.
   * @returns What happened, and everything to send.
   * @throws Where another attempt is in prospect, so Temporal makes one.
   */
  async runOneExecution(payload: string): Promise<ExecutionReport> {
    const triggering = await WIRE.deserialize(payload);
    const where = await destinationFor(triggering);

    if (where.kind !== 'opens' && where.kind !== 'answers') {
      // A mechanism was handed something no handler implements. Not a
      // failure of the work — a failure of whoever routed it — so no
      // amount of retrying helps.
      throw ApplicationFailure.nonRetryable(
        `nothing here implements ${triggering.to}, so this execution cannot be run`,
        'arvo_unroutable',
      );
    }

    const executionId = where.executionId;
    const handler = where.handler;
    // Temporal counts attempts from one and Arvo from zero. The
    // translation happens here and nowhere else.
    const attempt = activityInfo().attempt - 1;

    // Told once, so a long execution is cancellable and a worker that
    // dies is noticed rather than waited out.
    heartbeat({ executionId, attempt });

    const giveBack: Array<() => void> = [];
    try {
      const ran = await handler.tryExecute({
        event: triggering,
        // Read on every invocation, and never anything read earlier: a
        // retry has to see what the store says now.
        state: async ({ executionId: asked }) =>
          (await scope.store.readRecord(asked)) as JSONObject | null,
        attempt,
        // Resolved through the factory on this attempt and discarded
        // with it, so nothing live survives a suspension.
        dependencies: async (param) => {
          const { catalogue, release } = await catalogueFor(scope.pool);
          giveBack.push(release);
          return {
            catalogue,
            executionId: param.executionId,
            attempt: param.attempt,
            resumed: param.state,
          };
        },
      });

      if (!ran.ok) {
        const fault = ran.error;

        // The case ADR-008 names as the one a mechanism is most likely
        // to get wrong: this execution already exists, which means this
        // event has already been executed. A redelivery, not a failure.
        if (fault.faultKind === 'record_unexpected') {
          return republish(
            scope,
            executionId,
            triggering,
            'this event had already been executed',
          );
        }

        if (fault.retry !== null) {
          // Thrown so Temporal makes the next attempt, after the delay
          // the fault asked for rather than one a policy invented.
          throw ApplicationFailure.create({
            message: `${fault.faultKind}: ${fault.message}`,
            type: fault.faultKind,
            nonRetryable: false,
            nextRetryDelay: fault.retry.retryInMs,
            details: [{ faultKind: fault.faultKind, attempt: fault.attempt }],
          });
        }

        return giveUp(scope, fault, triggering, executionId);
      }

      if (ran.value.kind === 'discarded') {
        return republish(scope, executionId, triggering, ran.value.reason);
      }

      const outcome = await scope.store.commit({
        record: ran.value.state,
        events: ran.value.events,
      });

      if (!outcome.committed) {
        // Another writer reached this revision first. Whatever it
        // committed is what the world is told; this attempt publishes
        // that rather than its own.
        return republish(
          scope,
          executionId,
          triggering,
          `another writer committed first: ${outcome.because}`,
        );
      }

      const committed = await scope.store.committedFor(
        executionId,
        triggering.id,
      );
      const lifecycle = lifecycleOf(ran.value.state);

      return {
        outcome: 'committed',
        lifecycle,
        finished: restsForGood(lifecycle),
        dispatch: await dispatchFor(scope, committed),
        note: null,
      };
    } finally {
      for (const release of giveBack) release();
    }
  },

  /**
   * Says that these events have been sent.
   *
   * Called after the workflow has dispatched them, which is what makes
   * the workflow the publisher and leaves the recovery drain with only
   * what no workflow got round to.
   */
  async published(eventIds: readonly string[]): Promise<number> {
    return scope.store.markPublished(eventIds);
  },

  /**
   * Leaves an event where a person can find it, having failed to send it.
   *
   * The workflow's own dispatch can fail in a way no retry fixes — an
   * answer for an execution whose workflow is gone — and an answer that
   * vanishes is worse than one that is filed.
   */
  async couldNotSend(param: {
    payload: string;
    executionId: string;
    message: string;
  }): Promise<void> {
    const event = await WIRE.deserialize(param.payload);
    await needsAPerson(scope.pool, {
      event,
      payload: param.payload,
      why: 'nothing_will_retry',
      executionId: param.executionId,
      message: param.message,
    });
  },
});

/** What the workflow sees of the activities, which is their signatures. */
export type Activities = ReturnType<typeof createActivities>;
