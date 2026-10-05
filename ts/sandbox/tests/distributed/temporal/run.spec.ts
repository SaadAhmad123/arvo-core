import {
  ArvoEventSerializer,
  createArvoEventFactory,
  deriveArvoExecutionId,
} from 'arvo-core';
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
import { hand, outcomeOf } from '../../../src/distributed/temporal/client.js';
import {
  emptyTheStore,
  startTemporalHarness,
  type TemporalHarness,
  until,
} from './harness.js';

/**
 * One whole run, under Temporal, end to end.
 *
 * Narrow on purpose. Everything the scenario does happens here — the
 * fan-out, the recursive walk, a request that leaves the lattice, work
 * that fails and then does not, work that is given up on, and a sink
 * emitted alongside a completion — but two of each rather than five
 * hundred, because what is being established first is that the
 * mechanism carries the shape at all. Scale is a separate question and
 * gets its own measurements.
 *
 * It needs the stack up and migrated.
 */

const WIRE = new ArvoEventSerializer({ type: 'arvoevent' });

/** Wide enough to be a fan-out, small enough to read in a log. */
const WIDTH = 2;

/** Deep enough to recurse and unwind, well inside the walk's bound. */
const DEPTH = 2;

describe('one run under Temporal', () => {
  let harness: TemporalHarness;
  let orderExecutionId: string;

  beforeAll(async () => {
    harness = await startTemporalHarness('arvo-temporal-run-spec');
    await emptyTheStore(harness.pool);

    const opening = createArvoEventFactory(orderFulfilV1).createInput({
      source: 'com.test.temporal',
      subject: `temporal-run-${Date.now()}`,
      to: orderFulfilContract.type,
      data: {
        orderRef: 'order-temporal-1',
        category: 'orders',
        width: WIDTH,
        depth: DEPTH,
      },
    });
    orderExecutionId = await deriveArvoExecutionId(opening);

    const handed = await hand(harness.client, opening);
    expect(handed).toEqual({ kind: 'opened', executionId: orderExecutionId });
  }, 120_000);

  afterAll(async () => {
    await harness?.stop();
  }, 60_000);

  it('rests at waiting until a person answers what left the lattice', async () => {
    // The review carries a domain, so no handler may be given it and
    // nothing in the run will ever answer it. The execution that asked
    // waits, which is what waiting is supposed to mean.
    const waiting = await until('the review to need a person', async () => {
      const outstanding = await outstandingForAPerson(
        harness.pool,
        'left_the_lattice',
      );
      return outstanding.length > 0 ? outstanding : null;
    });

    const review = waiting[0];
    expect(review).toBeDefined();
    if (review === undefined) return;
    expect(review.eventType).toBe('com_manual_review');
    expect(review.domain).toBe('human_review');

    // and the order is still going, because it is still waiting
    const record = await harness.store.readRecord(orderExecutionId);
    expect(record?.lifecycle).toBe('waiting');

    // now something outside decides, and the answer is built from the
    // request so that it names what it answers
    const request = await WIRE.deserialize(review.payload);
    const handed = await hand(
      harness.client,
      decisionFor(request, { approved: true, by: 'the review desk' }),
    );
    expect(handed).toEqual({
      kind: 'answered',
      executionId: request.executionid,
    });
    await answeredByAPerson(harness.pool, review.eventId);
  }, 120_000);

  it('finishes once everything it asked for has answered', async () => {
    const summary = await outcomeOf(harness.client, orderExecutionId);

    expect(summary.contractType).toBe('com_order_fulfil');
    expect(summary.lifecycle).toBe('success');
    // One delivery for the event that opened it and one for each answer
    // that arrived. Every answer is a delivery: the record advances a
    // revision to record it, and the executor is entered on the one
    // that completes the collection.
    expect(summary.executions).toBeGreaterThan(WIDTH);
  }, 180_000);

  it('took the payment that failed first, counting attempts from zero', async () => {
    const charged = await until('the charge to be committed', async () => {
      const found = await harness.pool.query<{
        document: { lifecycle: string; data: { attempts: number } };
      }>(
        `SELECT document FROM execution_record
         WHERE source = 'com_payment_charge'
         ORDER BY cas_version DESC LIMIT 1`,
      );
      return found.rows[0] ?? null;
    });

    expect(charged.document.lifecycle).toBe('success');
    // It was asked to fail twice, so it succeeded on the attempt after
    // those. Temporal counts from one and Arvo from zero, and a
    // mechanism that forgot would record a different number here.
    expect(charged.document.data.attempts).toBe(2);
  }, 120_000);

  it('gave up on the work that never succeeds, and said so to its caller', async () => {
    const abandoned = await until(
      'the fraud check to be given up on',
      async () => {
        const found = await harness.pool.query<{
          execution_id: string;
          lifecycle: string;
        }>(
          `SELECT execution_id, lifecycle FROM execution_record
         WHERE source = 'com_fraud_check'
         ORDER BY cas_version DESC LIMIT 1`,
        );
        return found.rows[0] ?? null;
      },
    );

    // Rested at failure, which is where an execution given up on rests.
    expect(abandoned.lifecycle).toBe('failure');

    // And the event the fault carried was committed with that record
    // and published, rather than being composed by the mechanism.
    const told = await harness.pool.query<{ event_type: string }>(
      `SELECT event_type FROM outbox
       WHERE execution_id = $1 AND published_at IS NOT NULL`,
      [abandoned.execution_id],
    );
    expect(told.rows.map((row) => row.event_type)).toEqual([
      'handler_com_fraud_check_error',
    ]);
  }, 120_000);

  it('walked the tree, one execution per node', async () => {
    const walked = await harness.pool.query<{ count: string }>(
      `SELECT count(DISTINCT execution_id) FROM execution_record
       WHERE source = 'com_category_walk'`,
    );
    // More than one, because it recursed; the exact number is the
    // catalogue's business rather than this spec's.
    expect(Number(walked.rows[0]?.count ?? 0)).toBeGreaterThan(1);
  });

  it('wrote the audit that answers nobody, in the same batch as the completion', async () => {
    const audit = await until('the audit to be committed', async () => {
      const found = await harness.pool.query<{ lifecycle: string }>(
        `SELECT lifecycle FROM execution_record
         WHERE source = 'com_audit_write' ORDER BY cas_version DESC LIMIT 1`,
      );
      return found.rows[0] ?? null;
    });

    // No outputs and no services, so it rests at success having
    // returned nothing — the one shape a framework expecting a return
    // value meets here.
    expect(audit.lifecycle).toBe('success');

    // It left in the same commit as the order's own completion, because
    // a sink answers nobody and waiting for it would wait forever.
    const together = await harness.pool.query<{ event_type: string }>(
      `SELECT event_type FROM outbox
       WHERE execution_id = $1
         AND cas_version = (SELECT max(cas_version) FROM execution_record WHERE execution_id = $1)`,
      [orderExecutionId],
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
      const found = outstanding.filter(
        (one) => one.eventType === 'evt_order_fulfilled',
      );
      return found.length > 0 ? found : null;
    });

    expect(answered[0]?.addressedTo).toBe('com.test.temporal');
  }, 120_000);

  it('advanced every record one revision at a time, from zero', async () => {
    const wrong = await harness.pool.query<{ execution_id: string }>(
      `SELECT execution_id FROM execution_record
       GROUP BY execution_id
       HAVING min(cas_version) <> 0
           OR max(cas_version) <> count(*) - 1`,
    );
    expect(wrong.rows).toEqual([]);
  });

  it('published everything it committed, and committed everything it published', async () => {
    const unpublished = await harness.pool.query<{ count: string }>(
      'SELECT count(*) FROM outbox WHERE published_at IS NULL',
    );
    expect(unpublished.rows[0]?.count).toBe('0');
  });
});
