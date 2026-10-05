import type { Client } from '@temporalio/client';
import { ArvoEventSerializer } from 'arvo-core';
import type { RecordStore } from '../shared/store.js';
import { handToCluster } from './client.js';

/**
 * The publisher of last resort.
 *
 * On the ordinary path a workflow sends what its own delivery committed,
 * and a workflow's decisions survive the worker that made them. What
 * reaches this is the case the outbox exists for: a record committed and
 * the events beside it never sent, because whatever was going to send
 * them stopped existing in between.
 *
 * It sends the bytes that were committed rather than asking an executor
 * to produce them again, which is why nothing here needs a handler to be
 * deterministic — and why a receiver must discard a repeat.
 */

/** The format an event was committed in, which is the format it is sent in. */
const WIRE = new ArvoEventSerializer({ type: 'arvoevent' });

/** How long an event is left to whoever committed it, by default. */
const GRACE_MS = 30_000;

/** What one pass did. */
export type Recovered = {
  readonly sent: number;
  /** What each send did, for a caller that wants to know which path it took. */
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
    async (committedEvent) => {
      const handed = await handToCluster(
        param.client,
        await WIRE.deserialize(committedEvent.payload),
      );
      outcomes.push(handed.kind);
    },
    { afterMs: param.graceMs ?? GRACE_MS, atMost: param.atMost },
  );

  return { sent, outcomes };
};
