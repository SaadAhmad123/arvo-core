import {
  condition,
  defineQuery,
  defineSignal,
  defineUpdate,
  log,
  ParentClosePolicy,
  proxyActivities,
  setHandler,
  startChild,
  workflowInfo,
} from '@temporalio/workflow';
import type { JSONObject } from 'arvo-core';
import type { Activities, DeliveryReport } from './activities.js';
import type {
  CommitOutcome,
  CommitRequest,
  CommittedEvent,
  DeliveryParam,
  NeedsAPersonParam,
  PersonsDecision,
  RecordParam,
} from './protocol.js';
import { BOOKKEEPING_ACTIVITY, DELIVERY_ACTIVITY } from './retry.js';

/**
 * This mechanism's three workflows.
 *
 * Nothing here is stored outside Temporal. An execution's record is a
 * workflow's own state, the events committed beside it are that
 * workflow's queued commands, the queues are task queues, and an event
 * nothing may answer is a workflow waiting for somebody.
 *
 * None of them decide what an event means. Every such decision is made
 * in an activity, below them, by the handler.
 */

// ---------------------------------------------------------------- record

/** Reads the record this workflow holds. */
export const recordHeld = defineQuery<JSONObject | null>('arvo.record');

/** Commits a record and the events produced with it, or refuses to. */
export const commit = defineUpdate<CommitOutcome, [CommitRequest]>(
  'arvo.commit',
);

/** How many events this record has published. */
export const publishedCount = defineQuery<number>('arvo.published');

/** Lifecycles that accept nothing further, so the record may be let go of. */
const TERMINAL = new Set(['success', 'error', 'cancelled', 'failure']);

/** Where a record rests, read off the document the handler wrote. */
const lifecycleOf = (record: JSONObject): string =>
  typeof record.lifecycle === 'string' ? record.lifecycle : '';

/** The revision a record states, read off the document the handler wrote. */
const casVersionOf = (record: JSONObject): number =>
  typeof record.casVersion === 'number' ? record.casVersion : -1;

/**
 * One execution's record, and the events committed with it.
 *
 * One workflow per execution, so writes to one record are serialized by
 * Temporal admitting one workflow of a given name. The revision the
 * handler writes is still checked against the one held, which makes it a
 * consistency check here rather than the thing doing the work.
 *
 * The commit returns as soon as the new record is durable. Publishing
 * happens afterwards, from what the commit queued — so nothing is
 * delivered that was not committed, and everything committed is
 * eventually delivered.
 *
 * @param param - The execution whose record this is.
 */
export async function executionRecord(param: RecordParam): Promise<{
  executionId: string;
  revisions: number;
  lifecycle: string;
  published: number;
}> {
  let record: JSONObject | null = null;
  let revisions = 0;
  let published = 0;

  /** Committed and not yet delivered. The outbox, as Temporal holds it. */
  const outstanding: CommittedEvent[] = [];

  setHandler(recordHeld, () => record);
  setHandler(publishedCount, () => published);

  setHandler(commit, (asked: CommitRequest): CommitOutcome => {
    const writing = casVersionOf(asked.record);

    if (record === null) {
      // Create-if-absent: a first record may only be revision zero.
      if (writing !== 0) {
        return { committed: false, because: 'revision_out_of_sequence' };
      }
    } else if (writing !== casVersionOf(record) + 1) {
      return {
        committed: false,
        because:
          writing <= casVersionOf(record)
            ? 'revision_taken'
            : 'revision_out_of_sequence',
      };
    }

    record = asked.record;
    revisions += 1;
    // Queued rather than sent: the caller is told the record is durable,
    // and these go out after. Sending here would mean an event could
    // leave before the commit it belongs to was recorded.
    outstanding.push(...asked.events);

    return { committed: true, casVersion: writing };
  });

  while (true) {
    await condition(
      () =>
        outstanding.length > 0 ||
        (record !== null && TERMINAL.has(lifecycleOf(record))),
    );

    const sending = outstanding.splice(0, outstanding.length);
    if (sending.length > 0) {
      await deliverAll(sending);
      published += sending.length;
      continue;
    }

    // Terminal and nothing outstanding. The record stays readable from
    // this workflow's history for as long as the namespace retains it.
    return {
      executionId: param.executionId,
      revisions,
      lifecycle: record === null ? '' : lifecycleOf(record),
      published,
    };
  }
}

/**
 * Starts a delivery for each event, and a wait for each nobody can answer.
 *
 * All at once: a wide fan-out started one at a time would take one round
 * trip per event to do what Temporal batches.
 */
const deliverAll = async (events: readonly CommittedEvent[]): Promise<void> => {
  await Promise.all(
    events.map(async (event) => {
      if (event.target !== null) {
        await startOnce(event.target.workflowId, () =>
          startChild(deliverEvent, {
            workflowId: event.target?.workflowId ?? event.eventId,
            taskQueue: event.target?.taskQueue ?? '',
            args: [
              {
                payload: event.payload,
                addressedTo: event.target?.addressedTo ?? '',
              },
            ],
            // Nothing here owns anything there: a delivery outlives the
            // record that produced it.
            parentClosePolicy: ParentClosePolicy.ABANDON,
          }),
        );
        return;
      }

      await startOnce(`needs-a-person-${event.eventId}`, () =>
        startChild(needsAPerson, {
          workflowId: `needs-a-person-${event.eventId}`,
          taskQueue: workflowInfo().taskQueue,
          args: [
            {
              payload: event.payload,
              eventType: event.eventType,
              reason: event.needsAPerson ?? 'addressed_outside',
              message: null,
            },
          ],
          parentClosePolicy: ParentClosePolicy.ABANDON,
        }),
      );
    }),
  );
};

/** Whether a failure is Temporal saying that workflow is already there. */
const isAlreadyStarted = (raised: unknown): boolean =>
  raised instanceof Error &&
  raised.name === 'WorkflowExecutionAlreadyStartedError';

/** Starts something, treating already-started as the outcome asked for. */
const startOnce = async (
  workflowId: string,
  start: () => Promise<unknown>,
): Promise<void> => {
  try {
    await start();
  } catch (raised) {
    if (!isAlreadyStarted(raised)) throw raised;
    log.info('that was already under way', { workflowId });
  }
};

// -------------------------------------------------------------- delivery

const { runOneDelivery } = proxyActivities<Activities>(DELIVERY_ACTIVITY);
const { commitRecord } = proxyActivities<Activities>(BOOKKEEPING_ACTIVITY);

/** What one delivery's workflow answers with. */
export type DeliverySummary = {
  readonly eventId: string;
  readonly addressedTo: string;
  readonly outcome: DeliveryReport['outcome'];
  readonly executionId: string | null;
  readonly note: string | null;
};

/**
 * Delivers one event to the handler it is addressed to.
 *
 * One workflow per event, named by the event's own id, so an event
 * delivered twice is delivered once. Nothing is held open between
 * deliveries: what an execution remembers is in its record, so an
 * execution waiting on an answer is a record nothing has arrived for
 * rather than a workflow sitting idle.
 *
 * @param param - The event, and what it is addressed to.
 */
export async function deliverEvent(
  param: DeliveryParam,
): Promise<DeliverySummary> {
  const report = await runOneDelivery(param.payload);

  if (report.commit !== null) {
    // The record's own workflow decides whether this revision may be
    // written, and sends what it accepts.
    await commitRecord(report.commit);
  }

  return {
    eventId: workflowInfo().workflowId,
    addressedTo: param.addressedTo,
    outcome: report.outcome,
    executionId: report.executionId,
    note: report.note,
  };
}

// ------------------------------------------------------- needs a person

/** A person's decision about one lifted event. */
export const decided = defineSignal<[PersonsDecision]>('arvo.decided');

/** What this is waiting for, for anybody looking at it from outside. */
export const waitingFor = defineQuery<NeedsAPersonParam>('arvo.waiting_for');

/**
 * One event nothing in the lattice may answer.
 *
 * A request carrying a domain waits here for as long as the person does,
 * which is what waiting means. An event addressed outside, or a delivery
 * no further attempt would fix, has nobody to wait for and is recorded
 * and done — findable afterwards by what it was.
 *
 * @param param - The event, and why it is here.
 */
export async function needsAPerson(
  param: NeedsAPersonParam,
): Promise<{ reason: string; answered: boolean }> {
  setHandler(waitingFor, () => param);

  if (param.reason !== 'left_the_lattice') {
    // Nobody is coming. This exists so the event is somewhere a person
    // can find it rather than nowhere.
    log.warn('this event needs a person and nothing will answer it', {
      eventType: param.eventType,
      reason: param.reason,
    });
    return { reason: param.reason, answered: false };
  }

  let decision: PersonsDecision | null = null;
  setHandler(decided, (made: PersonsDecision) => {
    decision = made;
  });

  await condition(() => decision !== null);
  const made = decision as unknown as PersonsDecision;

  await startOnce(made.target.workflowId, () =>
    startChild(deliverEvent, {
      workflowId: made.target.workflowId,
      taskQueue: made.target.taskQueue,
      args: [{ payload: made.payload, addressedTo: made.target.addressedTo }],
      parentClosePolicy: ParentClosePolicy.ABANDON,
    }),
  );

  return { reason: param.reason, answered: true };
}
