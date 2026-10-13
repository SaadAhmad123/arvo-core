import type { ApplicationFailure } from '@temporalio/activity';
import { MockActivityEnvironment } from '@temporalio/testing';
import {
  type ArvoEvent,
  ArvoEventSerializer,
  createArvoEventFactory,
  deriveArvoExecutionId,
} from 'arvo-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { paymentChargeV1 } from '../../../src/distributed/handler/com_payment_charge/contract.js';
import { createActivities } from '../../../src/distributed/temporal/activities.js';
import type { DeliveryReport } from '../../../src/distributed/temporal/protocol.js';
import {
  commitTo,
  revisionsOf,
} from '../../../src/distributed/temporal/record-store.js';
import { startTemporalHarness, type TemporalHarness } from './harness.js';

/**
 * Obligation 4, against Temporal.
 *
 * > The mechanism re-invokes the handler with the same event and the
 * > incremented attempt number.
 *
 * The payment handler is the instrument: it refuses while the attempt is
 * below what it was asked for and succeeds after. Keyed on the attempt
 * rather than on what it remembers, so a mechanism that counts from the
 * wrong number produces a charge that either never succeeds or succeeds
 * on its first try — and both are visible here and nowhere else.
 *
 * Needs the cluster up.
 */

const WIRE = new ArvoEventSerializer({ type: 'arvoevent' });

/** How many times the gateway is to refuse before answering. */
const REFUSALS = 2;

describe('one delivery per attempt', () => {
  let harness: TemporalHarness;
  /** One delivery, at the attempt number Temporal would be on. */
  let deliverOnAttempt: (
    attempt: number,
    event: ArvoEvent,
  ) => Promise<DeliveryReport>;

  beforeAll(async () => {
    harness = await startTemporalHarness('arvo-temporal-retries-spec');
    const activities = createActivities({
      client: harness.client,
      pool: harness.pool,
    });
    const charge = activities[paymentChargeV1.type];
    if (charge === undefined) throw new Error('no activity for the handler');

    deliverOnAttempt = async (attempt, event) =>
      (await new MockActivityEnvironment({ attempt }).run(
        charge,
        await WIRE.serialize(event),
      )) as DeliveryReport;
  }, 120_000);

  afterAll(async () => {
    await harness?.stop();
  }, 60_000);

  const aCharge = (subject: string) =>
    createArvoEventFactory(paymentChargeV1).createInput({
      source: 'com.test.retries',
      subject,
      to: paymentChargeV1.type,
      data: { amount: 42, currency: 'GBP', failuresBeforeSuccess: REFUSALS },
    });

  /** What a delivery raised, where it raised anything. */
  const raisedBy = async (
    attempt: number,
    event: ArvoEvent,
  ): Promise<ApplicationFailure | null> =>
    deliverOnAttempt(attempt, event)
      .then(() => null)
      .catch((failure: unknown) => failure as ApplicationFailure);

  it('counts from one where the handler counts from zero', async () => {
    const asked = aCharge(`retry-counting-${Date.now()}`);
    const executionId = await deriveArvoExecutionId(asked);

    // Temporal's first attempt is the handler's attempt zero, which is
    // below what the gateway was asked to refuse.
    expect((await raisedBy(1, asked))?.type).toBe('executor_raised');
    expect((await raisedBy(2, asked))?.type).toBe('executor_raised');

    // and the one after the refusals succeeds
    const charged = await deliverOnAttempt(REFUSALS + 1, asked);
    expect(charged.outcome).toBe('produced');

    const revisions = await revisionsOf(harness.client, executionId);
    // the handler recorded which attempt did it, so the mapping is
    // visible in the record rather than only in whether it succeeded
    expect(revisions[0]?.state.data).toMatchObject({ attempts: REFUSALS });
  }, 180_000);

  it('honours the delay the fault asked for, which grows with the attempt', async () => {
    const asked = aCharge(`retry-delay-${Date.now()}`);

    const first = await raisedBy(1, asked);
    const second = await raisedBy(2, asked);

    // carried on the failure itself, rather than left to whatever
    // interval a policy happens to declare
    expect(first?.nextRetryDelay).toBeDefined();
    expect(second?.nextRetryDelay).toBeDefined();
    // and it is the handler's own function of the attempt, so a later
    // attempt waits longer
    expect(Number(second?.nextRetryDelay)).toBeGreaterThan(
      Number(first?.nextRetryDelay),
    );
  }, 180_000);

  it('reads the record again on the next attempt, and sees what moved', async () => {
    const asked = aCharge(`retry-sees-change-${Date.now()}`);
    const executionId = await deriveArvoExecutionId(asked);

    // The first attempt finds no record, because a refused delivery
    // writes none.
    expect((await raisedBy(1, asked))?.type).toBe('executor_raised');
    expect(await revisionsOf(harness.client, executionId)).toEqual([]);

    // Moved behind the mechanism's back, between attempts.
    const moved = await commitTo(harness.client, {
      executionId,
      revision: {
        triggeringEventId: 'moved-between-attempts',
        state: { executionId, casVersion: 0, lifecycle: 'idle' },
        events: [],
      },
    });
    expect(moved.committed).toBe(true);

    // The attempt that would otherwise have succeeded now finds a
    // record where an opening event expects none — so it read the store
    // again rather than carrying forward what the first attempt saw.
    const later = await deliverOnAttempt(REFUSALS + 1, asked);
    expect(later.outcome).toBe('nothing');
    expect(later.note).toContain('already been executed');
  }, 180_000);

  it('gives its connection back on every attempt, however many there are', async () => {
    const asked = aCharge(`retry-no-leak-${Date.now()}`);
    const beforehand = harness.pool.totalCount;

    // More attempts than the pool holds. A dependency carried forward,
    // or one never closed, exhausts the pool rather than slowing down —
    // so this would stop here rather than fail an assertion.
    for (let attempt = 1; attempt <= harness.pool.options.max + 4; attempt++) {
      await raisedBy(attempt > REFUSALS ? 1 : attempt, asked);
    }

    expect(harness.pool.waitingCount).toBe(0);
    expect(harness.pool.totalCount).toBeLessThanOrEqual(
      harness.pool.options.max,
    );
    // and it grew by at most what one delivery at a time needs
    expect(harness.pool.totalCount - beforehand).toBeLessThanOrEqual(1);
  }, 300_000);
});
