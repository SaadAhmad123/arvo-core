import {
  ArvoEventSerializer,
  createArvoEventFactory,
  deriveArvoExecutionId,
} from 'arvo-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resumeRun } from '../../../src/distributed/dbos/client.js';
import { manualReviewV1 } from '../../../src/distributed/handler/com_manual_review/contract.js';
import { orderFulfilV1 } from '../../../src/distributed/handler/com_order_fulfil/contract.js';
import { moveRunAcrossMechanisms } from '../../../src/distributed/replay/across-mechanisms.js';
import { clearRecords } from '../../../src/distributed/replay/clear.js';
import { decisionFor } from '../../../src/distributed/shared/from-outside.js';
import { storeFor } from '../../../src/distributed/shared/record-store.js';
import { startRun } from '../../../src/distributed/temporal/client.js';
import { type DbosHarness, startDbosHarness } from '../dbos/harness.js';
import {
  startTemporalHarness,
  type TemporalHarness,
} from '../temporal/harness.js';

/**
 * Task 12.6: a run taken under Temporal, finished under DBOS.
 *
 * This is the one test that proves the claim the whole model rests on.
 * Temporal keeps a run's records in Temporal; DBOS keeps them in
 * Postgres. If the record is the memory, then moving the records is
 * enough — the mechanism that wrote them cannot matter, and the run
 * finishes under a framework that never saw it start.
 *
 * The run is taken to where it waits on something only a person can
 * answer, which is the furthest a run can get without being finished.
 * Then the records move, and the answer is given under the other
 * mechanism.
 *
 * Needs the cluster up, the stack up, and both migrated.
 */

const WIRE = new ArvoEventSerializer({ type: 'arvoevent' });

/** What this run answers to. Not a handler's type, as a sender must ensure. */
const CALLER = 'com.test.across';

/** Narrow, so the record graph is small enough to read. */
const WIDTH = 2;
const DEPTH = 1;

describe('a run that changed mechanism half way through', () => {
  let temporal: TemporalHarness;
  let dbos: DbosHarness;

  beforeAll(async () => {
    temporal = await startTemporalHarness('arvo-across-temporal');
    dbos = await startDbosHarness('arvo-across-dbos');
  }, 240_000);

  afterAll(async () => {
    await temporal?.stop();
    await dbos?.stop();
  }, 120_000);

  it('finishes under DBOS what Temporal began, with only the records moved', async () => {
    // Nothing of any earlier run in the receiving store, so what DBOS
    // reads is what was moved rather than what happened to be there.
    await clearRecords(dbos.pool);

    const orderRef = `across-${Date.now()}`;
    const opening = createArvoEventFactory(orderFulfilV1).createInput({
      source: CALLER,
      subject: orderRef,
      to: orderFulfilV1.type,
      data: { orderRef, category: 'orders', width: WIDTH, depth: DEPTH },
    });
    const rootExecutionId = await deriveArvoExecutionId(opening);

    // ---------------------------------------------------- under Temporal

    const waiting = await startRun(temporal.client, opening);
    expect(waiting.kind).toBe('waiting_on_outside');

    const asked = await WIRE.deserialize(waiting.events[0]?.payload as string);
    expect(asked.type).toBe(manualReviewV1.type);

    // Nothing of this run is in the receiving store yet: the records are
    // in Temporal, where the mechanism that made them keeps them.
    const store = storeFor(dbos.pool);
    expect(await store.readRecord(rootExecutionId)).toBeNull();

    // ------------------------------------------------------- the move

    const moved = await moveRunAcrossMechanisms(
      temporal.client,
      store,
      rootExecutionId,
    );

    // the root and every execution reachable from it, which is every
    // execution the run opened
    expect(moved.executionIds[0]).toBe(rootExecutionId);
    expect(moved.executionIds.length).toBeGreaterThan(WIDTH);
    expect(moved.revisions).toBeGreaterThan(moved.executionIds.length);

    // and the orchestrator's record arrived as it was, still waiting
    const carried = await store.readRecord(rootExecutionId);
    expect(carried?.lifecycle).toBe('waiting');
    expect(carried?.subject).toBe(orderRef);

    // --------------------------------------------------- under DBOS

    // The answer a person gives, delivered to a mechanism that never saw
    // this run start. Where the run answers is passed in, which this
    // adapter does for simplicity rather than from necessity — the root
    // record holds the event that opened the run, and its `source` is
    // the caller.
    const answered = await resumeRun(
      dbos.workflows,
      decisionFor(asked, { approved: true, by: 'a.spec' }),
      CALLER,
    );

    expect(answered.kind).toBe('answered');
    expect(answered.events).toHaveLength(1);

    const answer = await WIRE.deserialize(answered.events[0] as string);
    expect(answer.type).toBe('evt_order_fulfilled');
    expect(answer.to).toBe(CALLER);
    // the caller's own workflow, carried the whole way across
    expect(answer.subject).toBe(orderRef);

    // and the orchestrator came to rest under DBOS, on the record
    // Temporal wrote
    const finished = await store.readRecord(rootExecutionId);
    expect(finished?.lifecycle).toBe('success');
  }, 480_000);
});
