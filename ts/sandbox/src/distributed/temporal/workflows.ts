import {
  ApplicationFailure,
  condition,
  defineQuery,
  defineUpdate,
  log,
  proxyActivities,
  setHandler,
} from '@temporalio/workflow';
import type { JSONObject } from 'arvo-core';
import type { Activities } from './activities.js';
import type {
  CommitOutcome,
  Delivery,
  EmittedEvent,
  RecordParam,
  Revision,
  RunOutcome,
  RunParam,
} from './protocol.js';
import { DELIVERY_ACTIVITY } from './retry.js';

/**
 * This mechanism's two workflows: the loop, and the record.
 *
 * Nothing is stored outside Temporal. An execution's revisions are a
 * workflow's own state, the work queue is a workflow's own array, and
 * the queues are task queues.
 *
 * Neither workflow decides what an event means. Every such decision is
 * made below them, in an activity, by the handler
 * (`openspec/changes/declare-arvoeventhandler/mechanism_algorithm.md`).
 */

// ---------------------------------------------------------------- record

/** The record this execution last committed, or `null` where none. */
export const stateHeld = defineQuery<JSONObject | null>('arvo.state');

/** Every revision this execution has committed. */
export const revisionsHeld = defineQuery<readonly Revision[]>('arvo.revisions');

/** Commits a revision, or refuses to. */
export const commitRevision = defineUpdate<CommitOutcome, [Revision]>(
  'arvo.commit',
);

/** Lifecycles that accept nothing further. */
const TERMINAL = new Set(['success', 'error', 'cancelled', 'failure']);

/** Where a record rests, read off the document the handler wrote. */
const lifecycleOf = (state: JSONObject): string =>
  typeof state.lifecycle === 'string' ? state.lifecycle : '';

/** The revision a record states, read off the document the handler wrote. */
const casVersionOf = (state: JSONObject): number =>
  typeof state.casVersion === 'number' ? state.casVersion : -1;

/**
 * One execution's record.
 *
 * One workflow per execution, named after the execution the handler
 * identified, so writes to one record are serialized by Temporal
 * admitting one workflow of a given name. The revision the handler
 * writes is still checked against the one held, which makes the counter
 * a consistency check here rather than the thing doing the work.
 *
 * A revision is the record and the events committed with it, kept as one
 * thing — so whatever happens after the write, those events can still be
 * read back and sent.
 *
 * It ends when the execution comes to rest, and stays queryable after
 * that from its own history. An execution that has not come to rest
 * keeps its workflow open, which is what waiting means — and what it
 * costs, since a namespace expires only what has closed.
 *
 * @param param - The execution whose record this is.
 */
export async function executionRecord(param: RecordParam): Promise<{
  executionId: string;
  revisions: number;
  lifecycle: string;
}> {
  const revisions: Revision[] = [];

  const latest = (): JSONObject | null =>
    revisions.length === 0
      ? null
      : (revisions[revisions.length - 1]?.state ?? null);

  setHandler(stateHeld, latest);
  setHandler(revisionsHeld, () => revisions);

  setHandler(commitRevision, (asked: Revision): CommitOutcome => {
    const writing = casVersionOf(asked.state);
    const held = latest();

    // `null` and an empty list are different answers: one says this
    // delivery was never carried out, the other that it was and emitted
    // nothing.
    const committedFor = (
      triggeringEventId: string,
    ): readonly EmittedEvent[] | null =>
      revisions.find(
        (revision) => revision.triggeringEventId === triggeringEventId,
      )?.events ?? null;

    if (held === null) {
      // create-if-absent: a first revision may only be revision zero
      if (writing !== 0) {
        return {
          committed: false,
          because: 'revision_out_of_sequence',
          alreadyCommitted: null,
        };
      }
    } else if (writing !== casVersionOf(held) + 1) {
      return {
        committed: false,
        because:
          writing <= casVersionOf(held)
            ? 'revision_taken'
            : 'revision_out_of_sequence',
        alreadyCommitted: committedFor(asked.triggeringEventId),
      };
    }

    revisions.push(asked);
    return { committed: true, casVersion: writing };
  });

  await condition(() => {
    const held = latest();
    return held !== null && TERMINAL.has(lifecycleOf(held));
  });

  const held = latest();
  return {
    executionId: param.executionId,
    revisions: revisions.length,
    lifecycle: held === null ? '' : lifecycleOf(held),
  };
}

// ------------------------------------------------------------------- run

/**
 * One activity per handler, each named after the contract it implements.
 *
 * Reached by name so a history and a trace say which handler ran. The
 * loop learns the name from the event's own address, which the activity
 * put on every emission.
 */
const deliverTo = proxyActivities<Activities>(DELIVERY_ACTIVITY);

/** How many deliveries the loop makes at once. */
const AT_ONCE = 64;

/** What a run is doing, for anybody looking at it from outside. */
export const runProgress = defineQuery<{
  delivered: number;
  waiting: number;
}>('arvo.progress');

/**
 * The loop.
 *
 * Takes the event it is given, delivers it to the handler it is
 * addressed to, and sorts what comes back: an event carrying a domain
 * has left the lattice, one addressed to this run's caller is the
 * answer, and anything else is more work. It ends when there is no work
 * left.
 *
 * It reads `source` once, on the way in, and `domain` and `to` on each
 * emission. It never asks whether an event opens an execution or answers
 * one, which execution it concerns, or what a record should say.
 *
 * @param param - The event entering the lattice.
 */
export async function arvoRun(param: RunParam): Promise<RunOutcome> {
  // Where this run answers. Read off the event by whoever sent it in,
  // because that sender is the one obliged to make it something no
  // handler is named by.
  const answersTo = param.answersTo;

  const work: Delivery[] = [
    { payload: param.payload, addressedTo: param.addressedTo },
  ];
  const domained: EmittedEvent[] = [];
  const responses: EmittedEvent[] = [];
  let delivered = 0;

  setHandler(runProgress, () => ({ delivered, waiting: work.length }));

  while (work.length > 0) {
    const taking = work.splice(0, AT_ONCE);

    const reports = await Promise.all(
      taking.map((delivery) => {
        const deliverToHandler = deliverTo[delivery.addressedTo];
        if (deliverToHandler === undefined) {
          throw ApplicationFailure.nonRetryable(
            `no handler named ${delivery.addressedTo} is registered on this worker`,
            'arvo_unroutable',
          );
        }
        return deliverToHandler(delivery.payload);
      }),
    );
    delivered += taking.length;

    for (const report of reports) {
      for (const emitted of report.emitted) {
        if (emitted.domain !== null) {
          domained.push(emitted);
          continue;
        }
        if (emitted.addressedTo === answersTo) {
          responses.push(emitted);
          continue;
        }
        if (emitted.handled && emitted.addressedTo !== null) {
          work.push({
            payload: emitted.payload,
            addressedTo: emitted.addressedTo,
          });
          continue;
        }

        throw ApplicationFailure.nonRetryable(
          `${emitted.eventType} ${emitted.eventId} is addressed to ${emitted.addressedTo}, which is neither a handler in this lattice nor the caller this run answers to`,
          'arvo_unroutable_emission',
        );
      }
    }
  }

  log.info('the run has no work left', {
    delivered,
    responses: responses.length,
    domained: domained.length,
  });

  if (responses.length > 0) {
    return { kind: 'answered', events: responses, deliveries: delivered };
  }
  if (domained.length > 0) {
    return {
      kind: 'waiting_on_outside',
      events: domained,
      deliveries: delivered,
    };
  }
  return { kind: 'nothing', events: [], deliveries: delivered };
}
