import { ArvoEventSerializer } from 'arvo-core';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { startRun } from '../../../src/distributed/dbos/client.js';
import { injectFailure } from '../../../src/distributed/shared/delivery-middleware.js';
import {
  anInventoryCheck,
  INJECTION_CASES,
  meetsExpectation,
  RETRYABLE_ONCE,
} from '../shared/injection.js';
import { type DbosHarness, startDbosHarness } from './harness.js';

/**
 * Layers under DBOS, with failures injected through them.
 *
 * The same cases as under the plain loop and Temporal; DBOS retries a
 * retryable fault itself, inside the step.
 *
 * Needs the stack up and migrated.
 */

const WIRE = new ArvoEventSerializer({ type: 'arvoevent' });

describe('layers under DBOS', () => {
  let harness: DbosHarness;

  beforeAll(async () => {
    harness = await startDbosHarness('arvo-dbos-middleware-spec');
  }, 120_000);

  afterEach(() => injectFailure(null));

  afterAll(async () => {
    await harness?.stop();
  }, 60_000);

  const deliver = async (label: string) => {
    const step = harness.steps.com_inventory_check;
    if (step === undefined) throw new Error('no step for the inventory check');
    return step(await WIRE.serialize(anInventoryCheck(label)));
  };

  it('carries a delivery through every layer where nothing is injected', async () => {
    const report = await deliver('clean');
    expect(report.outcome).toBe('produced');
    expect(report.lifecycle).toBe('success');
  });

  it.each(INJECTION_CASES)(
    '$name',
    async ({ failure, expected }) => {
      injectFailure(failure);
      const report = await deliver(failure.kind);
      expect(await meetsExpectation(report, expected)).toEqual(expected);
    },
    30_000,
  );

  it('a before part that faults retryably: raised for DBOS rather than reported', async () => {
    injectFailure(RETRYABLE_ONCE);
    // called outside a workflow, every call is attempt 0 to Arvo
    await expect(deliver('retry-bare')).rejects.toMatchObject({
      faultKind: 'executor_raised',
    });
  }, 30_000);

  it('a before part that faults once, retryably: inside a run, DBOS retries the step and the run is answered', async () => {
    injectFailure(RETRYABLE_ONCE);
    const outcome = await startRun(
      harness.workflows,
      anInventoryCheck('retry-run'),
    );
    expect(outcome.kind).toBe('answered');
  }, 60_000);
});
