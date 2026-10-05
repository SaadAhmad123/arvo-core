import { ArvoEventSerializer, createArvoEventFactory } from 'arvo-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  orderFulfilContract,
  orderFulfilV1,
} from '../../../src/distributed/handler/com_order_fulfil/contract.js';
import { decisionFor } from '../../../src/distributed/shared/from-outside.js';
import {
  answeredByAPerson,
  outstandingForAPerson,
} from '../../../src/distributed/shared/needs-a-person.js';
import { handToCluster } from '../../../src/distributed/temporal/client.js';
import {
  emptyTheStore,
  recordOf,
  startTemporalHarness,
  type TemporalHarness,
  until,
} from './harness.js';

/**
 * One whole run, under Temporal, end to end.
 *
 * Narrow on purpose: everything the scenario does happens here, two of
 * each rather than hundreds. What is established is that the mechanism
 * carries the shape at all; scale is measured separately.
 *
 * Needs the stack up and migrated.
 */

const WIRE = new ArvoEventSerializer({ type: 'arvoevent' });

/** Wide enough to be a fan-out, small enough to read in a log. */
const WIDTH = 2;

/** Deep enough to recurse and unwind, inside the walk's declared bound. */
const DEPTH = 2;

describe('one run under Temporal', () => {
  let harness: TemporalHarness;
  let orderSubject: string;

  beforeAll(async () => {
    harness = await startTemporalHarness('arvo-temporal-run-spec');
    await emptyTheStore(harness.pool);

    orderSubject = `temporal-run-${Date.now()}`;
    const opening = createArvoEventFactory(orderFulfilV1).createInput({
      source: 'com.test.temporal',
      subject: orderSubject,
      to: orderFulfilContract.type,
      data: {
        orderRef: 'order-temporal-1',
        category: 'orders',
        width: WIDTH,
        depth: DEPTH,
      },
    });

    const handed = await handToCluster(harness.client, opening);
    expect(handed).toEqual({ kind: 'delivering', workflowId: opening.id });
  }, 120_000);

  afterAll(async () => {
    await harness?.stop();
  }, 60_000);

  it('rests at waiting until a person answers what left the lattice', async () => {
    const waiting = await until('the review to need a person', async () => {
      const outstanding = await outstandingForAPerson(
        harness.pool,
        'left_the_lattice',
      );
      return outstanding.length > 0 ? outstanding : null;
    });

    const review = waiting[0];
    if (review === undefined) throw new Error('nothing is waiting');
    expect(review.eventType).toBe('com_manual_review');
    expect(review.domain).toBe('human_review');

    // and the order is still going, because it is still waiting
    const order = await recordOf(harness.pool, 'com_order_fulfil');
    expect(order.lifecycle).toBe('waiting');

    const request = await WIRE.deserialize(review.payload);
    const answered = await handToCluster(
      harness.client,
      decisionFor(request, { approved: true, by: 'the review desk' }),
    );
    expect(answered.kind).toBe('delivering');
    await answeredByAPerson(harness.pool, review.eventId);
  }, 120_000);

  it('finishes once everything it asked for has answered', async () => {
    const order = await until('the order to come to rest', async () => {
      const latest = await recordOf(harness.pool, 'com_order_fulfil');
      return latest.lifecycle === 'waiting' ? null : latest;
    });

    expect(order.lifecycle).toBe('success');
  }, 180_000);

  it('took the payment that failed first, counting attempts from zero', async () => {
    const charge = await recordOf(harness.pool, 'com_payment_charge');
    expect(charge.lifecycle).toBe('success');

    // It was asked to fail twice, so it succeeded on the attempt after
    // those. Temporal counts from one and Arvo from zero.
    expect(charge.document.data?.attempts).toBe(2);
  }, 120_000);

  it('gave up on the work that never succeeds, and told its caller so', async () => {
    const fraud = await recordOf(harness.pool, 'com_fraud_check');
    expect(fraud.lifecycle).toBe('failure');

    const published = await harness.pool.query<{ event_type: string }>(
      `SELECT event_type FROM outbox
       WHERE execution_id = $1 AND published_at IS NOT NULL`,
      [fraud.executionId],
    );
    expect(published.rows.map((row) => row.event_type)).toEqual([
      'handler_com_fraud_check_error',
    ]);
  }, 120_000);

  it('walked the tree, one execution per node', async () => {
    const walked = await harness.pool.query<{ count: string }>(
      `SELECT count(DISTINCT execution_id) FROM execution_record
       WHERE source = 'com_category_walk'`,
    );
    expect(Number(walked.rows[0]?.count ?? 0)).toBeGreaterThan(1);
  });

  it('wrote the audit that answers nobody, committed with the completion', async () => {
    const audit = await recordOf(harness.pool, 'com_audit_write');
    expect(audit.lifecycle).toBe('success');

    const order = await recordOf(harness.pool, 'com_order_fulfil');
    const together = await harness.pool.query<{ event_type: string }>(
      `SELECT event_type FROM outbox
       WHERE execution_id = $1
         AND cas_version = (
           SELECT max(cas_version) FROM execution_record WHERE execution_id = $1
         )`,
      [order.executionId],
    );
    expect(together.rows.map((row) => row.event_type).sort()).toEqual([
      'com_audit_write',
      'evt_order_fulfilled',
    ]);
  }, 120_000);

  it('left the run its answer, which nothing here implements', async () => {
    const answered = await until('the run to be answered', async () => {
      const outstanding = await outstandingForAPerson(
        harness.pool,
        'addressed_outside',
      );
      const completions = outstanding.filter(
        (one) => one.eventType === 'evt_order_fulfilled',
      );
      return completions.length > 0 ? completions : null;
    });

    expect(answered[0]?.addressedTo).toBe('com.test.temporal');
  }, 120_000);

  it('advanced every record one revision at a time, from zero', async () => {
    const outOfSequence = await harness.pool.query<{ execution_id: string }>(
      `SELECT execution_id FROM execution_record
       GROUP BY execution_id
       HAVING min(cas_version) <> 0
           OR max(cas_version) <> count(*) - 1`,
    );
    expect(outOfSequence.rows).toEqual([]);
  });

  it('kept one version for each execution for its whole life', async () => {
    const drifted = await harness.pool.query<{ execution_id: string }>(
      `SELECT execution_id FROM execution_record
       GROUP BY execution_id
       HAVING count(DISTINCT version) <> 1`,
    );
    expect(drifted.rows).toEqual([]);
  });

  it('published everything it committed', async () => {
    const unpublished = await harness.pool.query<{ count: string }>(
      'SELECT count(*) FROM outbox WHERE published_at IS NULL',
    );
    expect(unpublished.rows[0]?.count).toBe('0');
  });
});
