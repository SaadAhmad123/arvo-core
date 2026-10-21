import { ArvoEventSerializer } from 'arvo-core';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  type DeliveryScope,
  deliverOnce,
  deliverWithRetries,
} from '../../../src/distributed/replay/delivery.js';
import { readConfig } from '../../../src/distributed/shared/config.js';
import { injectFailure } from '../../../src/distributed/shared/delivery-middleware.js';
import { storeFor } from '../../../src/distributed/shared/record-store.js';
import {
  anInventoryCheck,
  INJECTION_CASES,
  meetsExpectation,
  RETRYABLE_ONCE,
} from '../shared/injection.js';

/**
 * Layers under the plain loop, with failures injected through them.
 *
 * Every handler declares its own layers and this mechanism supplies two
 * more; each case then injects one failure and asserts what the protocol
 * makes of it.
 *
 * Needs the stack up and migrated.
 */

describe('layers under the plain loop', () => {
  let pool: Pool;
  let scope: DeliveryScope;

  beforeAll(async () => {
    const config = readConfig('arvo-replay-middleware-spec');
    pool = new Pool({
      connectionString: config.recordsUrl,
      max: config.recordsPoolSize,
    });
    scope = { store: storeFor(pool), pool };
  }, 120_000);

  afterEach(() => injectFailure(null));

  afterAll(async () => {
    await pool?.end();
  });

  it('carries a delivery through every layer where nothing is injected', async () => {
    const report = await deliverOnce(scope, anInventoryCheck('clean'), 0);
    expect(report.outcome).toBe('produced');
    expect(report.lifecycle).toBe('success');
  });

  it.each(INJECTION_CASES)(
    '$name',
    async ({ failure, expected }) => {
      injectFailure(failure);
      const report = await deliverOnce(
        scope,
        anInventoryCheck(failure.kind),
        0,
      );
      expect(await meetsExpectation(report, expected)).toEqual(expected);
    },
    30_000,
  );

  it('a before part that faults once, retryably: retried, and the next attempt answers', async () => {
    injectFailure(RETRYABLE_ONCE);
    const event = anInventoryCheck('retry');
    await expect(deliverOnce(scope, event, 0)).rejects.toMatchObject({
      faultKind: 'executor_raised',
    });
    const report = await deliverWithRetries(scope, event);
    expect(report.lifecycle).toBe('success');
  });

  it('keeps the answer the same with and without layers that only read', async () => {
    const wire = new ArvoEventSerializer({ type: 'arvoevent' });
    const report = await deliverOnce(scope, anInventoryCheck('shape'), 0);
    const [answer] = await Promise.all(
      report.emitted.map((one) => wire.deserialize(one)),
    );
    expect(answer?.type).toBe('evt_inventory_checked');
  });
});
