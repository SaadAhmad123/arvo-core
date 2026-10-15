import type { Client } from '@temporalio/client';
import {
  ArvoEventSerializer,
  deriveArvoExecutionId,
  type JSONObject,
} from 'arvo-core';
import type { RecordStore } from '../shared/record-store.js';
import { revisionsOf } from '../temporal/record-store.js';

/**
 * One run's records, moved from the store one mechanism keeps to the
 * store another keeps.
 *
 * This exists to ask the question the whole exercise is for: if the
 * record is the memory, the mechanism that wrote it cannot matter. A run
 * taken part of the way under Temporal, whose records live in Temporal,
 * must be finishable under DBOS, whose records live in Postgres, with
 * nothing moved but the records themselves.
 *
 * ## Why the graph is reachable at all
 *
 * Nothing indexes a run's executions. Temporal keeps one workflow per
 * record, named by the execution identifier, and no index maps a subject
 * to the executions under it.
 *
 * It does not need one. An execution's identity is derived from the
 * event that opened it, so every child is reachable from its parent: the
 * parent's revisions hold the events it emitted, and the identity of
 * whatever each of those opened is a function of that event. Start at the
 * root and the whole graph follows.
 *
 * That is a property of the derivation rather than of either mechanism,
 * which is why this walk works against a store that was never designed
 * to be walked.
 */

/** The format an event is stored in, under both mechanisms. */
const WIRE = new ArvoEventSerializer({ type: 'arvoevent' });

/** What was moved, so a caller can say whether anything was. */
export type Moved = {
  /** Every execution whose revisions were written, root first. */
  readonly executionIds: readonly string[];
  /** How many revisions in total. */
  readonly revisions: number;
  /** How many events were committed alongside them. */
  readonly events: number;
};

/**
 * Moves every record of one run from Temporal into a record store.
 *
 * Revisions are written in order, so the receiving store's own
 * constraints apply exactly as they would have to a run that happened
 * there: a first revision only where none exists, and every later one
 * exactly one greater. A move that violated either would be refused by
 * the database rather than quietly accepted, which is the point of
 * moving them through the store rather than inserting rows.
 *
 * @param from - The cluster holding the records.
 * @param into - The store to write them to.
 * @param rootExecutionId - The execution the run began with, which the
 * opening event derives to.
 * @returns What was moved.
 * @throws Where the receiving store refuses a revision, naming it.
 */
export const moveRunAcrossMechanisms = async (
  from: Client,
  into: RecordStore,
  rootExecutionId: string,
): Promise<Moved> => {
  const walked: string[] = [];
  const waiting = [rootExecutionId];
  const seen = new Set<string>();
  let revisions = 0;
  let events = 0;

  while (waiting.length > 0) {
    const executionId = waiting.shift() as string;
    if (seen.has(executionId)) continue;
    seen.add(executionId);

    const held = await revisionsOf(from, executionId);
    if (held.length === 0) continue;
    walked.push(executionId);

    for (const revision of held) {
      const committed = await Promise.all(
        revision.events.map((one) => WIRE.deserialize(one.payload)),
      );

      const outcome = await into.commit({
        record: revision.state as JSONObject,
        events: committed,
      });
      if (!outcome.committed) {
        throw new Error(
          `the receiving store refused a revision of ${executionId}: ${outcome.because}`,
        );
      }
      revisions += 1;
      events += committed.length;

      // Whatever these events opened is reachable from them, the
      // identity of an execution being derived from the event that
      // opened it. An event that opened nothing derives to an identifier
      // nothing is stored under, and the read for it answers with
      // nothing.
      // Derived for every one of them rather than only for those that
      // look like openings. Classification is the handler's, and nothing
      // here needs it: an event that opened nothing derives to an
      // identifier nothing is stored under, and the read for it answers
      // with nothing.
      for (const one of committed) {
        waiting.push(await deriveArvoExecutionId(one));
      }
    }
  }

  return { executionIds: walked, revisions, events };
};
