import {
  ApplicationFailure,
  activityInfo,
  heartbeat,
  log,
} from '@temporalio/activity';
import type { Client } from '@temporalio/client';
import {
  type ArvoEvent,
  ArvoEventSerializer,
  type ArvoHandlerFault,
  type JSONObject,
} from 'arvo-core';
import type { Pool } from 'pg';
import { catalogueFor } from '../shared/catalogue.js';
import { destinationFor } from '../shared/routing.js';
import type {
  CommitRequest,
  CommittedEvent,
  DeliveryTarget,
  NeedsAPersonReason,
} from './protocol.js';
import { queueFor } from './queues.js';
import { commitTo, recordFrom } from './record-store.js';

/**
 * One delivery: the handler an event is addressed to runs, and what it
 * produced is prepared for commit.
 *
 * Everything Arvo-specific in this mechanism is here. The workflows above
 * carry what this hands back and decide nothing about it; the handler
 * below knows nothing of Temporal.
 */

/** The format an event crosses a boundary in, and is stored in. */
const WIRE = new ArvoEventSerializer({ type: 'arvoevent' });

/** What one delivery did. */
export type DeliveryReport = {
  /**
   * `produced` wrote a record and events for the record's own workflow
   * to commit. `settled` found the work already done, or a writer ahead
   * of it, and left what that execution committed to whoever committed
   * it. `abandoned` gave up, with the record and event the fault
   * carried.
   */
  readonly outcome: 'produced' | 'settled' | 'abandoned';
  /** The execution concerned, where anything said which. */
  readonly executionId: string | null;
  /** What to commit, or `null` where there is nothing to commit. */
  readonly commit: CommitRequest | null;
  /**
   * Events with no record to be committed with.
   *
   * A fault that failed before a record could be read carries an event
   * for the caller and no record, and the outbox's guarantee is that an
   * event and a record are kept together — so there is nothing for this
   * one to be kept together with, and it goes on its own.
   */
  readonly orphans: readonly CommittedEvent[];
  /** Why, where the outcome needs a reason. */
  readonly note: string | null;
};

/** What the activities reach, built once per worker. */
export type ActivityScope = {
  /** Where the handlers' dependencies come from. Not where records live. */
  readonly pool: Pool;
  /** How a record's own workflow is reached. */
  readonly client: Client;
  readonly taskQueue: string;
};

/** The execution a record belongs to, read off the document. */
const executionOf = (record: JSONObject): string | null =>
  typeof record.executionId === 'string' ? record.executionId : null;

/**
 * Turns the events a handler produced into what to commit with them.
 *
 * Routing happens here because workflow code cannot see a handler: it is
 * bundled for an isolate, and the handlers are what decide the queue.
 */
const committedEventsFor = async (
  events: readonly ArvoEvent[],
): Promise<readonly CommittedEvent[]> =>
  Promise.all(
    events.map(async (event): Promise<CommittedEvent> => {
      const destination = destinationFor(event);
      const payload = await WIRE.serialize(event);

      const target: DeliveryTarget | null =
        destination.kind === 'handled'
          ? {
              // the event's own id: unique, and the same if delivered again
              workflowId: event.id,
              taskQueue: queueFor(destination.handler.contracts.self.type),
              addressedTo: destination.handler.contracts.self.type,
            }
          : null;

      const needsAPerson: NeedsAPersonReason | null =
        destination.kind === 'left'
          ? 'left_the_lattice'
          : destination.kind === 'outside'
            ? 'addressed_outside'
            : null;

      return {
        eventId: event.id,
        eventType: event.type,
        addressedTo: event.to,
        payload,
        target,
        needsAPerson,
      };
    }),
  );

/** Nothing to do, because this delivery's work was already done. */
const nothingToDo = (note: string): DeliveryReport => ({
  outcome: 'settled',
  executionId: null,
  commit: null,
  orphans: [],
  note,
});

/**
 * What a fault no further attempt will fix leaves behind.
 *
 * A fault carries both halves of an abandonment, the event alone, or
 * neither, and each is acted on as it stands — nothing of the
 * mechanism's own is added
 * (`docs/adr/008-arvoeventhandler-faults-and-abandonment.md`).
 */
const giveUp = async (
  fault: ArvoHandlerFault,
  triggeringEvent: ArvoEvent,
): Promise<DeliveryReport> => {
  const note = `${fault.faultKind}: ${fault.message}`;

  if (fault.abandonmentState !== null) {
    const record = JSON.parse(fault.abandonmentState) as JSONObject;
    const abandonmentEvent =
      fault.abandonmentEvent === null
        ? null
        : await WIRE.deserialize(fault.abandonmentEvent);

    return {
      outcome: 'abandoned',
      executionId: executionOf(record),
      commit: {
        record,
        events: await committedEventsFor(
          abandonmentEvent === null ? [] : [abandonmentEvent],
        ),
      },
      orphans: [],
      note,
    };
  }

  // The event alone, there being no record to carry forward. Nothing for
  // it to be preserved together with, so it goes on its own — and where
  // nothing can carry it, somewhere a person will find it.
  const orphan =
    fault.abandonmentEvent === null
      ? triggeringEvent
      : await WIRE.deserialize(fault.abandonmentEvent);

  return {
    outcome: 'abandoned',
    executionId: fault.executionId,
    commit: null,
    orphans: await committedEventsFor([orphan]),
    note,
  };
};

/**
 * Everything Temporal may run, bound to what this worker reaches.
 *
 * @param scope - The pool the handlers' dependencies come from, and the
 * client a record's own workflow is reached through.
 */
export const createActivities = (scope: ActivityScope) => ({
  /**
   * Runs the handler one event is addressed to.
   *
   * @param payload - The event, in the event's own format.
   * @returns What happened, and what is to be committed.
   * @throws Where a fault says a further attempt is in prospect, so
   * Temporal makes one.
   */
  async runOneDelivery(payload: string): Promise<DeliveryReport> {
    const triggeringEvent = await WIRE.deserialize(payload);
    const destination = destinationFor(triggeringEvent);

    if (destination.kind !== 'handled') {
      // Routed here wrongly rather than failed: no attempt fixes it.
      throw ApplicationFailure.nonRetryable(
        `nothing here implements ${triggeringEvent.to}`,
        'arvo_unroutable',
      );
    }

    // Temporal counts attempts from one and Arvo from zero.
    const attempt = activityInfo().attempt - 1;
    heartbeat({ eventId: triggeringEvent.id, attempt });

    const releaseEach: Array<() => void> = [];
    try {
      const executed = await destination.handler.tryExecute({
        event: triggeringEvent,
        // The handler says which execution to read; nothing here works
        // one out. Read on every invocation, so a retry sees what the
        // store says now.
        state: ({ executionId }) => recordFrom(scope.client, executionId),
        attempt,
        // Resolved on this attempt and let go of with it, so nothing
        // live survives a suspension.
        dependencies: async (param) => {
          const { catalogue, release } = await catalogueFor(scope.pool);
          releaseEach.push(release);
          return {
            catalogue,
            executionId: param.executionId,
            attempt: param.attempt,
            resumed: param.state,
          };
        },
      });

      if (!executed.ok) {
        const fault = executed.error;

        // An opening event for an execution that already exists is a
        // redelivery, not a failure. Treating it as one would publish a
        // handler error for work that succeeded.
        if (fault.faultKind === 'record_unexpected') {
          return nothingToDo('this event had already been executed');
        }

        if (fault.retry !== null) {
          throw ApplicationFailure.create({
            message: `${fault.faultKind}: ${fault.message}`,
            type: fault.faultKind,
            nonRetryable: false,
            nextRetryDelay: fault.retry.retryInMs,
            details: [{ faultKind: fault.faultKind, attempt: fault.attempt }],
          });
        }

        return giveUp(fault, triggeringEvent);
      }

      if (executed.value.kind === 'discarded') {
        return nothingToDo(executed.value.reason);
      }

      const record = executed.value.state;
      log.info('ran', {
        executionId: executionOf(record),
        emitted: executed.value.events.length,
      });

      return {
        outcome: 'produced',
        executionId: executionOf(record),
        commit: {
          record,
          events: await committedEventsFor(executed.value.events),
        },
        orphans: [],
        note: null,
      };
    } finally {
      for (const release of releaseEach) release();
    }
  },

  /**
   * Hands one record and the events beside it to the record's own
   * workflow, which decides whether that revision may be written.
   *
   * @param request - What to commit.
   * @returns Why it was refused, or `null` where it was committed.
   */
  async commitRecord(request: CommitRequest): Promise<string | null> {
    const executionId = executionOf(request.record);
    if (executionId === null) {
      throw ApplicationFailure.nonRetryable(
        'this record names no execution, so there is nowhere to commit it',
        'arvo_unaddressable_record',
      );
    }

    const outcome = await commitTo(scope.client, {
      executionId,
      taskQueue: scope.taskQueue,
      request,
    });

    if (outcome.committed) return null;

    // Losing is ordinary: the winner's record is what the world is told,
    // and the winner sends its own events.
    log.info('another writer committed first', {
      executionId,
      because: outcome.because,
    });
    return outcome.because;
  },
});

/** What the workflows see of the activities, which is their signatures. */
export type Activities = ReturnType<typeof createActivities>;
