import {
  ArvoEventSerializer,
  createArvoEventFactory,
  deriveArvoExecutionId,
} from 'arvo-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startRun } from '../../../src/distributed/dbos/client.js';
import { paymentChargeV1 } from '../../../src/distributed/handler/com_payment_charge/contract.js';
import { type DbosHarness, startDbosHarness } from './harness.js';

/**
 * Obligation 4, against DBOS.
 *
 * > The mechanism re-invokes the handler with the same event and the
 * > incremented attempt number.
 *
 * The attempt number is the whole of it, and it is where a mechanism
 * quietly goes wrong: DBOS counts attempts from one and Arvo from zero,
 * so a mechanism that forgets has a retry budget off by one and a
 * handler keyed on the attempt behaves differently under it than under
 * anything else.
 *
 * Needs the stack up and migrated.
 */

const WIRE = new ArvoEventSerializer({ type: 'arvoevent' });

/** How many attempts the payment handler fails before it succeeds. */
const FAILURES_BEFORE_SUCCESS = 2;

describe('what a retry carries', () => {
  let harness: DbosHarness;

  beforeAll(async () => {
    harness = await startDbosHarness('arvo-dbos-retries-spec');
  }, 120_000);

  afterAll(async () => {
    await harness?.stop();
  }, 60_000);

  /** A charge that fails the first few attempts and then does not. */
  const aCharge = (subject: string, failures = FAILURES_BEFORE_SUCCESS) =>
    createArvoEventFactory(paymentChargeV1).createInput({
      source: 'com.test.retries',
      subject,
      to: paymentChargeV1.type,
      data: {
        amount: 42,
        currency: 'GBP',
        failuresBeforeSuccess: failures,
      },
    });

  /** One delivery, outside any workflow, so the attempt is this spec's. */
  const deliverOnce = async (payload: string) => {
    const step = harness.steps[paymentChargeV1.type];
    if (step === undefined) throw new Error('no step for the handler');
    return step(payload);
  };

  it('counts the attempt as Arvo counts it, not as DBOS does', async () => {
    // Called outside a workflow there is no step status, which is a
    // plain first attempt — attempt 0 to Arvo. A mechanism passing
    // DBOS's own count straight through would say 1 here, and the
    // handler would believe it had already failed once.
    const asked = aCharge(`dbos-retry-first-${Date.now()}`, 1);

    // It fails on attempt 0 and says another attempt may succeed, which
    // is only true if it was told this was attempt 0.
    await expect(deliverOnce(await WIRE.serialize(asked))).rejects.toThrow(
      'on attempt 0',
    );
  }, 120_000);

  it('raises a failure another attempt could fix rather than reporting it', async () => {
    // Raised, because whether another attempt is made is not one
    // delivery's to decide. Reporting it would make the mechanism unable
    // to tell a failure from a result.
    const asked = aCharge(`dbos-retry-raised-${Date.now()}`);

    const raised = await deliverOnce(await WIRE.serialize(asked)).catch(
      (fault: unknown) => fault,
    );
    expect((raised as { faultKind?: string }).faultKind).toBe(
      'executor_raised',
    );
    // and it carries the verdict the handler reached, which is what this
    // mechanism's `shouldRetry` reads rather than deciding for itself
    expect((raised as { retry?: unknown }).retry).not.toBeNull();
  }, 120_000);

  it('succeeds once the attempt the handler was waiting for arrives', async () => {
    // The same event delivered again, as a retry is. Nothing is carried
    // forward but the attempt number: the handler reads the record
    // afresh and decides again.
    const asked = aCharge(`dbos-retry-succeeds-${Date.now()}`);
    const executionId = await deriveArvoExecutionId(asked);
    const payload = await WIRE.serialize(asked);

    // Attempts 0 and 1 fail, by the handler's own account of itself.
    await expect(deliverOnce(payload)).rejects.toThrow('attempt 0');

    // Started as a run, so DBOS counts the attempts and retries the step
    // under the declared policy until the handler succeeds.
    //
    // Through the client rather than by calling the registered workflow
    // as a property of anything: DBOS reads the receiver of such a call
    // as a configured instance and refuses it, so a workflow is always
    // passed as a value.
    const outcome = await startRun(harness.workflows, asked);
    expect(outcome.kind).toBe('answered');

    // one record, written by the attempt that succeeded
    const revisions = await harness.pool.query<{ lifecycle: string }>(
      'SELECT lifecycle FROM execution_record WHERE execution_id = $1',
      [executionId],
    );
    expect(revisions.rows).toHaveLength(1);
    expect(revisions.rows[0]?.lifecycle).toBe('success');
  }, 240_000);

  it('reads the record afresh on every attempt, with nothing cached', async () => {
    // A record written between attempts must be seen by the next one.
    // Here the first delivery commits, and the attempt after it sees the
    // execution already answered rather than the absence it first saw.
    const asked = aCharge(`dbos-retry-afresh-${Date.now()}`, 0);
    const payload = await WIRE.serialize(asked);

    const first = await deliverOnce(payload);
    expect(first.outcome).toBe('produced');

    const again = await deliverOnce(payload);
    expect(again.outcome).toBe('recovered');
  }, 120_000);
});
