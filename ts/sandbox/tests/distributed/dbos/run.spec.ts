import { ArvoEventSerializer, createArvoEventFactory } from 'arvo-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  answerFromOutside,
  runIdFor,
  startRun,
} from '../../../src/distributed/dbos/client.js';
import type { RunOutcome } from '../../../src/distributed/dbos/protocol.js';
import { manualReviewV1 } from '../../../src/distributed/handler/com_manual_review/contract.js';
import {
  orderFulfilContract,
  orderFulfilV1,
} from '../../../src/distributed/handler/com_order_fulfil/contract.js';
import { decisionFor } from '../../../src/distributed/shared/from-outside.js';
import { until } from '../shared/backends.js';
import { type DbosHarness, startDbosHarness } from './harness.js';

/**
 * One whole run under DBOS, to where it waits on a person and then to
 * where it answers.
 *
 * Narrow on purpose. Everything the scenario does happens here — the
 * fan-out, the recursive walk, a request that leaves the lattice, work
 * that fails and then does not, work that is given up on, and a sink
 * emitted alongside the completion — two of each rather than hundreds.
 *
 * Needs the stack up and migrated.
 */

const WIRE = new ArvoEventSerializer({ type: 'arvoevent' });

/** What this run answers to. Not a handler's type, as a sender must ensure. */
const CALLER = 'com.test.dbos';

/** Wide enough to be a fan-out, small enough to read in a log. */
const WIDTH = 2;

/** Deep enough to recurse and unwind, inside the walk's declared bound. */
const DEPTH = 2;

describe('one run under DBOS', () => {
  let harness: DbosHarness;
  let outcome: RunOutcome;
  let subject: string;

  beforeAll(async () => {
    harness = await startDbosHarness('arvo-dbos-run-spec');

    subject = `dbos-run-${Date.now()}`;
    const opening = createArvoEventFactory(orderFulfilV1).createInput({
      source: CALLER,
      subject,
      to: orderFulfilContract.type,
      data: {
        orderRef: `order-${Date.now()}`,
        category: 'orders',
        width: WIDTH,
        depth: DEPTH,
      },
    });

    // Started, not awaited: the run comes to rest holding a request only
    // something outside the lattice can answer, and answering it is what
    // lets the run finish.
    const running = startRun(harness.workflows, opening);

    const asked = await theReviewItAskedFor(harness, subject);
    await answerFromOutside(
      runIdFor(opening),
      decisionFor(asked, { approved: true, by: 'a.spec' }),
    );

    outcome = await running;
  }, 240_000);

  afterAll(async () => {
    await harness?.stop();
  }, 60_000);

  /** The record of one execution of a contract in this run. */
  const recordsOf = async (source: string) => {
    const rows = await harness.pool.query<{
      lifecycle: string;
      casVersion: number;
    }>(
      `SELECT lifecycle, cas_version::int AS "casVersion"
         FROM execution_record
        WHERE subject = $1 AND source = $2
        ORDER BY execution_id, cas_version`,
      [subject, source],
    );
    return rows.rows;
  };

  /** Where every execution of one contract came to rest. */
  const restingPlaces = async (source: string) => {
    const rows = await harness.pool.query<{
      lifecycle: string;
      count: string;
    }>(
      `SELECT lifecycle, count(*) AS count FROM execution_record record
        WHERE subject = $1 AND source = $2
          AND cas_version = (
            SELECT max(cas_version) FROM execution_record latest
             WHERE latest.execution_id = record.execution_id
          )
        GROUP BY lifecycle`,
      [subject, source],
    );
    return Object.fromEntries(
      rows.rows.map((row) => [row.lifecycle, Number(row.count)]),
    );
  };

  it('answers its caller once everything it asked for is in', async () => {
    expect(outcome.kind).toBe('answered');
    expect(outcome.events).toHaveLength(1);

    const answer = await WIRE.deserialize(outcome.events[0] as string);
    expect(answer.type).toBe('evt_order_fulfilled');
    expect(answer.to).toBe(CALLER);
  });

  it('makes a delivery for every execution the run needs', async () => {
    // the orchestrator, the fan-out, the walk and its children, the
    // payment with its retries, the fraud check, the sink, and the
    // review's answer
    expect(outcome.deliveries).toBeGreaterThan(WIDTH + DEPTH);
  });

  it('opens one execution per item of the fan-out', async () => {
    expect(await restingPlaces('com_inventory_check')).toEqual({
      success: WIDTH,
    });
  });

  it('descends and unwinds the walk, every level its own execution', async () => {
    const walks = await restingPlaces('com_category_walk');
    expect(walks.success).toBeGreaterThan(DEPTH);
    // and none left waiting: a walk that descended must come back up
    expect(walks.waiting).toBeUndefined();
  });

  it('takes payment, which failed before it did not', async () => {
    expect(await restingPlaces('com_payment_charge')).toEqual({ success: 1 });
  });

  it('gives up on the work nothing will fix, and says so on the record', async () => {
    expect(await restingPlaces('com_fraud_check')).toEqual({ failure: 1 });
  });

  it('completes the sink that answers nobody', async () => {
    expect(await restingPlaces('com_audit_write')).toEqual({ success: 1 });
  });

  it('writes one revision per answer the orchestrator collected', async () => {
    const revisions = await recordsOf('com_order_fulfil');
    // waiting until the last of them, then success: `collect: all` means
    // the executor is entered once with everything in
    expect(revisions.at(-1)?.lifecycle).toBe('success');
    expect(revisions.filter((one) => one.lifecycle === 'waiting')).toHaveLength(
      revisions.length - 1,
    );
    // and every revision follows the one before it
    expect(revisions.map((one) => one.casVersion)).toEqual(
      revisions.map((_, position) => position),
    );
  });

  it('leaves the request that left the lattice where a person finds it', async () => {
    const parked = await harness.pool.query<{ why: string }>(
      `SELECT why FROM needs_a_person WHERE subject = $1 AND event_type = $2`,
      [subject, manualReviewV1.type],
    );
    expect(parked.rows.map((row) => row.why)).toEqual(['left_the_lattice']);
  });
});

/**
 * The review request this run left for a person, once it is there.
 *
 * Looked for rather than awaited, because the point of a domained event
 * is that nothing running is told about it: a person finds it by
 * looking, and so does this. Waiting on the condition rather than on a
 * clock, so a slow run is slow rather than a failure.
 */
const theReviewItAskedFor = async (harness: DbosHarness, subject: string) =>
  until(`the review ${subject} asks for`, async () => {
    const found = await harness.pool.query<{ payload: string }>(
      `SELECT payload FROM needs_a_person
        WHERE subject = $1 AND event_type = $2
        LIMIT 1`,
      [subject, manualReviewV1.type],
    );
    const payload = found.rows[0]?.payload;
    return payload === undefined ? null : WIRE.deserialize(payload);
  });
