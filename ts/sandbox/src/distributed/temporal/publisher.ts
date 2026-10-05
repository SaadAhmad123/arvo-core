import type { Client } from '@temporalio/client';
import { ArvoEventSerializer } from 'arvo-core';
import type { RecordStore } from '../shared/store.js';
import { hand } from './client.js';

/**
 * The publisher of last resort.
 *
 * On the ordinary path a workflow sends what its own execution
 * committed, and a workflow's decisions survive the worker that made
 * them — so almost nothing reaches this. What does reach it is the one
 * case the outbox exists for: a record committed and the events beside
 * it never sent, because whatever was going to send them stopped
 * existing in between.
 *
 * It sends the bytes that were committed. It does not ask an executor to
 * produce them again, which is why nothing in this exercise requires a
 * handler to be deterministic — and why an event arriving twice has to
 * be discarded by whoever receives it rather than prevented here.
 *
 * It waits before taking anything over. An event committed a moment ago
 * is probably about to be sent by the workflow that committed it, and a
 * publisher that raced it would double every event in the run.
 */

/** The format an event was committed in, which is the format it is sent in. */
const WIRE = new ArvoEventSerializer({ type: 'arvoevent' });

/** How long an event is left to whoever committed it, by default. */
const GRACE_MS = 30_000;

/** What one pass of the publisher did. */
export type Recovered = {
  /** How many events it sent. */
  readonly sent: number;
  /** What each of them did, for a test that wants to know which path it took. */
  readonly outcomes: readonly string[];
};

/**
 * Sends everything committed and not sent, once.
 *
 * @param param - The cluster, the store, and how long to leave an event
 * to whoever committed it. A grace of zero takes everything outstanding,
 * which is what recovering from a killed worker wants and what a running
 * system does not.
 */
export const recoverOnce = async (param: {
  client: Client;
  store: RecordStore;
  graceMs?: number;
  atMost?: number;
}): Promise<Recovered> => {
  const outcomes: string[] = [];

  const sent = await param.store.drainOutbox(
    async (one) => {
      const event = await WIRE.deserialize(one.payload);
      const handed = await hand(param.client, event);
      outcomes.push(handed.kind);
    },
    { afterMs: param.graceMs ?? GRACE_MS, atMost: param.atMost },
  );

  return { sent, outcomes };
};
