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
import type { DeliveryReport, EmittedEvent } from './protocol.js';
import { commitTo, stateOf } from './record-store.js';

/**
 * One delivery: the handler an event is addressed to runs, and what it
 * produced is committed.
 *
 * Everything Arvo-specific in this mechanism is here. The loop above
 * carries what this hands back and decides nothing about it; the handler
 * below knows nothing of Temporal.
 */

/** The format an event crosses a boundary in, and is stored in. */
const WIRE = new ArvoEventSerializer({ type: 'arvoevent' });

/** What the activities reach, built once per worker. */
export type ActivityScope = {
  /** How a record's own workflow is reached. Where this mechanism stores. */
  readonly client: Client;
  /**
   * Where the handlers' own data comes from.
   *
   * Nothing of this mechanism is kept here. A handler asks for a
   * catalogue through the factory and this is what answers, on a
   * connection taken for one execution and given back with it.
   */
  readonly pool: Pool;
};

/** The execution a record belongs to, read off the document. */
const executionOf = (state: JSONObject): string | null =>
  typeof state.executionId === 'string' ? state.executionId : null;

/** Where a record rests, read off the document. */
const lifecycleOf = (state: JSONObject): string | null =>
  typeof state.lifecycle === 'string' ? state.lifecycle : null;

/**
 * An event in the form the loop sorts it by.
 *
 * Whether a handler implements the address is settled here because the
 * loop runs in an isolate that cannot see the handlers.
 */
const emittedFrom = async (event: ArvoEvent): Promise<EmittedEvent> => ({
  eventId: event.id,
  eventType: event.type,
  addressedTo: event.to,
  domain: event.domain,
  handled: destinationFor(event).kind === 'handled',
  payload: await WIRE.serialize(event),
});

/** Nothing to do, because this delivery's work was already done. */
const nothingToDo = (note: string): DeliveryReport => ({
  outcome: 'nothing',
  executionId: null,
  lifecycle: null,
  emitted: [],
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
  scope: ActivityScope,
  fault: ArvoHandlerFault,
  triggeringEvent: ArvoEvent,
): Promise<DeliveryReport> => {
  const note = `${fault.faultKind}: ${fault.message}`;

  const abandonmentEvent =
    fault.abandonmentEvent === null
      ? null
      : await WIRE.deserialize(fault.abandonmentEvent);

  // Neither half. The execution answered its caller already and rests
  // where it rests, so there is nothing to commit and nobody to tell.
  if (fault.abandonmentState === null && abandonmentEvent === null) {
    return nothingToDo(note);
  }

  // The event alone, there being no record to carry forward. Nothing for
  // it to be kept together with, so it goes on its own.
  if (fault.abandonmentState === null) {
    return {
      outcome: 'produced',
      executionId: fault.executionId,
      lifecycle: null,
      emitted:
        abandonmentEvent === null ? [] : [await emittedFrom(abandonmentEvent)],
      note,
    };
  }

  const state = JSON.parse(fault.abandonmentState) as JSONObject;
  const executionId = executionOf(state);
  if (executionId === null) {
    throw ApplicationFailure.nonRetryable(
      'the abandonment record names no execution, so there is nowhere to commit it',
      'arvo_unaddressable_record',
    );
  }

  const emitted =
    abandonmentEvent === null ? [] : [await emittedFrom(abandonmentEvent)];

  const outcome = await commitTo(scope.client, {
    executionId,
    revision: {
      triggeringEventId: triggeringEvent.id,
      state,
      events: emitted,
    },
  });

  if (outcome.committed) {
    return {
      outcome: 'produced',
      executionId,
      lifecycle: lifecycleOf(state),
      emitted,
      note,
    };
  }

  return {
    outcome: 'recovered',
    executionId,
    lifecycle: lifecycleOf(state),
    emitted: converged(outcome.alreadyCommitted, executionId, triggeringEvent),
    note,
  };
};

/**
 * What a delivery that lost the race publishes.
 *
 * Losing takes two forms and they are not the same. Where a revision
 * names this delivery's triggering event, this delivery already
 * succeeded once and what the world is told is what it committed then.
 * Where none does, the record moved on under a different delivery and
 * this one has not been carried out at all — so it is made again,
 * against the record as it now stands. Dropping it would lose the event.
 */
const converged = (
  alreadyCommitted: readonly EmittedEvent[] | null,
  executionId: string,
  triggeringEvent: ArvoEvent,
): readonly EmittedEvent[] => {
  if (alreadyCommitted !== null) return alreadyCommitted;

  throw ApplicationFailure.create({
    message: `execution ${executionId} moved on while ${triggeringEvent.id} was being carried out, so this delivery has to be made again against the record as it now stands`,
    type: 'arvo_record_moved_on',
    nonRetryable: false,
  });
};

/**
 * Everything Temporal may run, bound to what this worker reaches.
 *
 * @param scope - The client a record's own workflow is reached through.
 */
export const createActivities = (scope: ActivityScope) => ({
  /**
   * Delivers one event to the handler it is addressed to.
   *
   * @param payload - The event, in the event's own format.
   * @returns What happened, and everything committed, for the loop to
   * sort.
   * @throws Where a fault says a further attempt is in prospect, so
   * Temporal makes one.
   */
  async deliverOne(payload: string): Promise<DeliveryReport> {
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
        // one out. Read on every invocation, so a retry sees what is
        // stored now rather than what an earlier attempt read.
        state: ({ executionId }) => stateOf(scope.client, executionId),
        attempt,
        // Resolved on this attempt and let go of with it, so nothing
        // live survives a suspension and a leak exhausts the pool rather
        // than slowing a worker down.
        dependencies: async (param) => {
          const opened = await catalogueFor(scope.pool);
          releaseEach.push(opened.release);
          return {
            catalogue: opened.catalogue,
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

        return giveUp(scope, fault, triggeringEvent);
      }

      if (executed.value.kind === 'discarded') {
        return nothingToDo(executed.value.reason);
      }

      const state = executed.value.state;
      const executionId = executionOf(state);
      if (executionId === null) {
        throw ApplicationFailure.nonRetryable(
          'this record names no execution, so there is nowhere to commit it',
          'arvo_unaddressable_record',
        );
      }

      const emitted = await Promise.all(executed.value.events.map(emittedFrom));

      const outcome = await commitTo(scope.client, {
        executionId,
        revision: {
          triggeringEventId: triggeringEvent.id,
          state,
          events: emitted,
        },
      });

      if (!outcome.committed) {
        log.info('another writer committed first', {
          executionId,
          because: outcome.because,
        });
        return {
          outcome: 'recovered',
          executionId,
          lifecycle: lifecycleOf(state),
          emitted: converged(
            outcome.alreadyCommitted,
            executionId,
            triggeringEvent,
          ),
          note: outcome.because,
        };
      }

      return {
        outcome: 'produced',
        executionId,
        lifecycle: lifecycleOf(state),
        emitted,
        note: null,
      };
    } finally {
      for (const release of releaseEach) release();
    }
  },
});

/** What the loop sees of the activities, which is their signatures. */
export type Activities = ReturnType<typeof createActivities>;
