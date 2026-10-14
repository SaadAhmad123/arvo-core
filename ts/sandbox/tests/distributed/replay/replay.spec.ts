import { createArvoEventFactory, type JSONObject } from 'arvo-core';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fraudCheckV1 } from '../../../src/distributed/handler/com_fraud_check/contract.js';
import { orderFulfilContract } from '../../../src/distributed/handler/com_order_fulfil/contract.js';
import {
  clearRecords,
  restoreStock,
} from '../../../src/distributed/replay/clear.js';
import {
  comparablePayload,
  comparableRecord,
} from '../../../src/distributed/replay/comparison.js';
import type { DeliveryScope } from '../../../src/distributed/replay/delivery.js';
import { runOneWorkflow } from '../../../src/distributed/replay/loop.js';
import type { Transcript } from '../../../src/distributed/replay/protocol.js';
import { replayTranscript } from '../../../src/distributed/replay/replay.js';
import { transcriptOf } from '../../../src/distributed/replay/transcript.js';
import { readConfig } from '../../../src/distributed/shared/config.js';
import { storeFor } from '../../../src/distributed/shared/record-store.js';

/**
 * Section 12, against the simplest mechanism in the exercise.
 *
 * > A handler that comes out somewhere else on a replay is a handler
 * > whose record was not its memory.
 *
 * No framework takes part. There is no durable execution here, no
 * history and no retry policy, so nothing can be carrying a run forward
 * except what was committed — which is what makes this the control the
 * framework-backed mechanisms are read against.
 *
 * Needs the stack up and migrated.
 */

/** How wide and deep a run of this is: small, and exercising every branch. */
const WIDTH = 2;
const DEPTH = 1;

/** Something no handler is named by, which is where a run answers. */
const CALLER = 'com.test.replay';

/** A category this spec has to itself, so no other run can move its stock. */
const CATEGORY = 'orders/replayed';

/** What each of its items holds before a run touches it. */
const STOCK = 5;

describe('a run replayed from its record alone', () => {
  let pool: Pool;
  let scope: DeliveryScope;

  beforeAll(async () => {
    const config = readConfig('arvo-replay-spec');
    pool = new Pool({
      connectionString: config.recordsUrl,
      max: config.recordsPoolSize,
    });
    scope = { store: storeFor(pool), pool };

    // Items of this spec's own, so a replay can be given back exactly
    // the stock the run read. Nothing else reads this category.
    await pool.query(
      `INSERT INTO catalogue (sku, category, held)
       SELECT 'sku-replayed-' || position, $1, $2
         FROM generate_series(1, 4) AS position
       ON CONFLICT (sku) DO UPDATE SET held = $2, category = $1`,
      [CATEGORY, STOCK],
    );
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
  });

  /** The items this spec owns, which a replay has to be given back. */
  const OWNED = [1, 2, 3, 4].map((position) => `sku-replayed-${position}`);

  /** Nothing of a previous run alive: not its records, not its stock. */
  const anEmptyWorld = async () => {
    await clearRecords(pool);
    for (const sku of OWNED) await restoreStock(pool, sku, STOCK);
  };

  /** One order, entering the lattice from outside it. */
  const anOrder = (orderRef: string) =>
    createArvoEventFactory(orderFulfilContract.versions['1.0.0']).createInput({
      source: CALLER,
      subject: orderRef,
      to: orderFulfilContract.type,
      data: { orderRef, category: CATEGORY, width: WIDTH, depth: DEPTH },
    });

  /** A run, and the tape the database can describe it with afterwards. */
  const aRunAndItsTape = async (orderRef: string) => {
    await anEmptyWorld();
    const outcome = await runOneWorkflow(scope, anOrder(orderRef));
    return { outcome, tape: await transcriptOf(pool, orderRef) };
  };

  /** Every record a tape holds, as two runs of it can be compared. */
  const recordsOf = (tape: Transcript) =>
    tape.steps.map((step) => comparableRecord(step.committed));

  /**
   * Every event a tape holds, grouped by the revision it was committed
   * with and sorted within it.
   *
   * The grouping is compared because which revision an event belongs to
   * is a decision. The order inside one is not: the outbox has no
   * ordinal, so events committed together are read back in the order of
   * their identifiers, which are minted per event. A mechanism is not
   * obliged to publish them in any order either, so asserting one would
   * be asserting something nothing promised.
   */
  const eventsOf = (tape: Transcript) =>
    tape.steps.map((step) =>
      step.emitted
        .map((payload) => JSON.stringify(comparablePayload(payload)))
        .sort(),
    );

  // ---------------------------------------------------------------- 12.1

  it('is described by the database rather than by anything that watched it', async () => {
    const orderRef = `replay-described-${Date.now()}`;
    const { outcome, tape } = await aRunAndItsTape(orderRef);

    // the run did what this run does: asked for everything, and came to
    // rest holding what only something outside can answer
    expect(outcome.kind).toBe('waiting_on_outside');
    expect(tape.steps.length).toBeGreaterThan(WIDTH);

    // every step names the execution and revision it wrote
    for (const step of tape.steps) {
      expect(step.executionId).toMatch(/^[0-9a-f]{64}$/);
      expect(step.committed.executionId).toBe(step.executionId);
    }

    // the first revision of any execution read nothing, and every later
    // one read exactly the revision before it
    for (const step of tape.steps) {
      if (step.casVersion === 0) {
        expect(step.recordAsRead).toBeNull();
        continue;
      }
      expect(step.recordAsRead?.casVersion).toBe(step.casVersion - 1);
    }

    // and the event that entered from outside is recovered too, though
    // nothing ever committed it: the record it produced is holding it
    const opening = tape.steps.find(
      (step) => step.committed.source === orderFulfilContract.type,
    );
    const delivered = JSON.parse(opening?.delivered ?? 'null');
    expect(delivered.type).toBe(orderFulfilContract.type);
    expect(delivered.source).toBe(CALLER);
  }, 180_000);

  // ---------------------------------------------------------------- 12.2

  it('reaches every record and every event the run reached', async () => {
    const orderRef = `replay-equal-${Date.now()}`;
    const { tape } = await aRunAndItsTape(orderRef);

    // nothing of the run left alive, and the handlers' own data given
    // back: a replay reading what the run left is reading other inputs
    await anEmptyWorld();

    const played = await replayTranscript(scope, tape);
    expect(played.length).toBe(tape.steps.length);

    const again = await transcriptOf(pool, orderRef);
    expect(recordsOf(again)).toEqual(recordsOf(tape));
    expect(eventsOf(again)).toEqual(eventsOf(tape));
  }, 180_000);

  it('writes the same revisions under the same execution identifiers', async () => {
    const orderRef = `replay-identity-${Date.now()}`;
    const { tape } = await aRunAndItsTape(orderRef);
    await anEmptyWorld();
    await replayTranscript(scope, tape);

    const again = await transcriptOf(pool, orderRef);
    expect(
      again.steps.map((step) => `${step.executionId}:${step.casVersion}`),
    ).toEqual(
      tape.steps.map((step) => `${step.executionId}:${step.casVersion}`),
    );
  }, 180_000);

  // ---------------------------------------------------------------- 12.3

  it('comes to the same rest where the tape is repeated', async () => {
    const orderRef = `replay-repeated-${Date.now()}`;
    const { tape } = await aRunAndItsTape(orderRef);
    await anEmptyWorld();

    // every step twice, in order: the second of each pair is a
    // redelivery of an event already carried out
    const repeated = tape.steps.flatMap((_, position) => [position, position]);
    const played = await replayTranscript(scope, tape, repeated);

    // each first delivery produced; each repeat found the work done and
    // handed back what was committed, rather than faulting or producing
    // a second time
    const firsts = played.filter((_, position) => position % 2 === 0);
    const repeats = played.filter((_, position) => position % 2 === 1);
    expect(firsts.every((step) => step.report.outcome === 'produced')).toBe(
      true,
    );
    expect(repeats.every((step) => step.report.outcome !== 'produced')).toBe(
      true,
    );

    // and the store holds one run, not two
    const again = await transcriptOf(pool, orderRef);
    expect(again.steps.length).toBe(tape.steps.length);
    expect(recordsOf(again)).toEqual(recordsOf(tape));
  }, 180_000);

  it('refuses a tape played out of order rather than writing a record out of sequence', async () => {
    const orderRef = `replay-shuffled-${Date.now()}`;
    const { tape } = await aRunAndItsTape(orderRef);
    await anEmptyWorld();

    // Deliberately backwards, which is the strongest disorder a tape
    // has: every answer before the execution that asked for it exists.
    const backwards = tape.steps.map((_, position) => position).reverse();
    const played = await replayTranscript(scope, tape, backwards);

    // Refused by reporting rather than by raising. A commit that does
    // not follow the revision before it is not a broken worker, and a
    // delivery that reports it can be made again — which is why the
    // store answers instead of throwing.
    expect(played.some((step) => step.report.outcome !== 'produced')).toBe(
      true,
    );

    // What must hold whatever order they arrived in: every execution's
    // revisions start at zero and follow one another, so nothing was
    // written on top of a revision that was never there. The store
    // enforces it; this is the end-to-end confirmation.
    const afterwards = await transcriptOf(pool, orderRef);
    const byExecution = new Map<string, number[]>();
    for (const step of afterwards.steps) {
      byExecution.set(step.executionId, [
        ...(byExecution.get(step.executionId) ?? []),
        step.casVersion,
      ]);
    }
    for (const [, versions] of byExecution) {
      expect(versions.sort((one, two) => one - two)).toEqual(
        versions.map((_, position) => position),
      );
    }

    // and no execution came out further along than the run took it
    expect(afterwards.steps.length).toBeLessThanOrEqual(tape.steps.length);
  }, 180_000);

  // ---------------------------------------------------------------- 12.4

  it('commits an abandonment the same way on a replay as on the run', async () => {
    // The fraud check gives up on every execution, and has a record by
    // the time it says so, so its fault carries both halves. What is
    // under test is that a replay commits the pair together too, and
    // adds nothing of the mechanism's own to either.
    const orderRef = `replay-abandoned-${Date.now()}`;
    await anEmptyWorld();

    const asked = createArvoEventFactory(fraudCheckV1).createInput({
      source: CALLER,
      subject: orderRef,
      to: fraudCheckV1.type,
      data: { orderRef },
    });

    const outcome = await runOneWorkflow(scope, asked);
    const tape = await transcriptOf(pool, orderRef);

    // one revision, holding the record and the event together
    expect(tape.steps.length).toBe(1);
    const only = tape.steps[0] as (typeof tape.steps)[number];
    expect((only.committed as JSONObject).lifecycle).toBe('failure');
    expect(only.emitted.length).toBe(1);
    expect(outcome.kind).toBe('answered');

    await anEmptyWorld();
    await replayTranscript(scope, tape);

    const again = await transcriptOf(pool, orderRef);
    expect(recordsOf(again)).toEqual(recordsOf(tape));
    expect(eventsOf(again)).toEqual(eventsOf(tape));
  }, 180_000);
});
