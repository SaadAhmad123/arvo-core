import { MockActivityEnvironment } from '@temporalio/testing';
import { type ArvoEvent, ArvoEventSerializer } from 'arvo-core';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { injectFailure } from '../../../src/distributed/shared/delivery-middleware.js';
import { createActivities } from '../../../src/distributed/temporal/activities.js';
import type { DeliveryReport } from '../../../src/distributed/temporal/protocol.js';
import {
  anInventoryCheck,
  INJECTION_CASES,
  meetsExpectation,
  RETRYABLE_ONCE,
} from '../shared/injection.js';
import { startTemporalHarness, type TemporalHarness } from './harness.js';

/**
 * Layers under Temporal, with failures injected through them.
 *
 * The same cases as under the plain loop and DBOS. A retryable fault is
 * raised for Temporal to retry, so the retry is driven here by running
 * the activity again at the next attempt, as Temporal would.
 *
 * Needs the cluster up.
 */

const WIRE = new ArvoEventSerializer({ type: 'arvoevent' });

describe('layers under Temporal', () => {
  let harness: TemporalHarness;
  let deliver: (event: ArvoEvent, attempt?: number) => Promise<DeliveryReport>;

  beforeAll(async () => {
    harness = await startTemporalHarness('arvo-temporal-middleware-spec');
    const activities = createActivities({
      client: harness.client,
      pool: harness.pool,
    });
    deliver = async (event, attempt = 1) => {
      const one = activities.com_inventory_check;
      if (one === undefined)
        throw new Error('no activity for the inventory check');
      const context = new MockActivityEnvironment({ attempt });
      return (await context.run(
        one,
        await WIRE.serialize(event),
      )) as DeliveryReport;
    };
  }, 120_000);

  afterEach(() => injectFailure(null));

  afterAll(async () => {
    await harness?.stop();
  }, 60_000);

  it('carries a delivery through every layer where nothing is injected', async () => {
    const report = await deliver(anInventoryCheck('clean'));
    expect(report.outcome).toBe('produced');
    expect(report.lifecycle).toBe('success');
  });

  it.each(INJECTION_CASES)(
    '$name',
    async ({ failure, expected }) => {
      injectFailure(failure);
      const report = await deliver(anInventoryCheck(failure.kind));
      expect(await meetsExpectation(report, expected)).toEqual(expected);
    },
    30_000,
  );

  it('a before part that faults once, retryably: raised for Temporal, and the next attempt answers', async () => {
    injectFailure(RETRYABLE_ONCE);
    const event = anInventoryCheck('retry');
    await expect(deliver(event, 1)).rejects.toThrow();
    const report = await deliver(event, 2);
    expect(report.lifecycle).toBe('success');
  }, 30_000);
});
