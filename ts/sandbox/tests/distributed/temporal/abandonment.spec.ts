import { ApplicationFailure } from '@temporalio/activity';
import { MockActivityEnvironment } from '@temporalio/testing';
import {
  ARVO_CATEGORY_COMPLETE,
  type ArvoEvent,
  ArvoEventSerializer,
  createArvoEvent,
  createArvoEventFactory,
  deriveArvoExecutionId,
} from 'arvo-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { categoryWalkV1 } from '../../../src/distributed/handler/com_category_walk/contract.js';
import { fraudCheckV1 } from '../../../src/distributed/handler/com_fraud_check/contract.js';
import { paymentChargeV1 } from '../../../src/distributed/handler/com_payment_charge/contract.js';
import { createActivities } from '../../../src/distributed/temporal/activities.js';
import type { DeliveryReport } from '../../../src/distributed/temporal/protocol.js';
import { revisionsOf } from '../../../src/distributed/temporal/record-store.js';
import { startTemporalHarness, type TemporalHarness } from './harness.js';

/**
 * Obligation 3, against Temporal.
 *
 * > A mechanism that abandons an execution MUST do so with the fault's
 * > `abandonment_state` and `abandonment_event`, together, and with
 * > nothing of its own.
 *
 * A fault carries both halves, the event alone, or neither, and the
 * mechanism acts on each as it stands. What it must never do is compose
 * either half itself, or keep attempting something a fault said no
 * attempt would fix.
 *
 * Needs the cluster up.
 */

const WIRE = new ArvoEventSerializer({ type: 'arvoevent' });

describe('giving up on an execution', () => {
  let harness: TemporalHarness;
  /** One delivery of one event, to whichever handler it is addressed to. */
  let deliver: (
    contractType: string,
    event: ArvoEvent,
  ) => Promise<DeliveryReport>;

  beforeAll(async () => {
    harness = await startTemporalHarness('arvo-temporal-abandonment-spec');
    const activities = createActivities({
      client: harness.client,
      pool: harness.pool,
    });

    deliver = async (contractType, event) => {
      const one = activities[contractType];
      if (one === undefined) throw new Error(`no activity for ${contractType}`);
      const context = new MockActivityEnvironment({ attempt: 1 });
      return (await context.run(
        one,
        await WIRE.serialize(event),
      )) as DeliveryReport;
    };
  }, 120_000);

  afterAll(async () => {
    await harness?.stop();
  }, 60_000);

  // --------------------------------------------- a fault carrying both halves

  it('commits the record and the event the fault carried, together', async () => {
    // The fraud check says no attempt will fix it, and it has a record
    // by the time it says so — so the fault carries both halves.
    const asked = createArvoEventFactory(fraudCheckV1).createInput({
      source: 'com.test.abandonment',
      subject: `abandon-both-${Date.now()}`,
      to: fraudCheckV1.type,
      data: { orderRef: 'order-abandon-1' },
    });
    const executionId = await deriveArvoExecutionId(asked);

    const report = await deliver(fraudCheckV1.type, asked);

    // returned, not thrown: the delivery did what the protocol asked of
    // it, and marking it failed would make a correct abandonment look
    // like a broken worker
    expect(report.outcome).toBe('produced');
    expect(report.note).toContain('no fraud model is deployed');

    const revisions = await revisionsOf(harness.client, executionId);
    expect(revisions).toHaveLength(1);

    const only = revisions[0];
    if (only === undefined) throw new Error('nothing was committed');

    // both halves, in one revision
    expect(only.state.lifecycle).toBe('failure');
    expect(only.events.map((one) => one.eventType)).toEqual([
      'handler_com_fraud_check_error',
    ]);
    // and the mechanism composed neither: the event is the one the fault
    // carried, byte for byte, and the loop is told to deliver it
    expect(report.emitted.map((one) => one.payload)).toEqual(
      only.events.map((one) => one.payload),
    );
  }, 120_000);

  it('does not attempt again what a fault said no attempt would fix', async () => {
    const asked = createArvoEventFactory(fraudCheckV1).createInput({
      source: 'com.test.abandonment',
      subject: `abandon-no-retry-${Date.now()}`,
      to: fraudCheckV1.type,
      data: { orderRef: 'order-abandon-2' },
    });

    // Nothing is thrown, so there is no failure for a retry policy to
    // act on — which is a stronger guarantee than a failure marked
    // non-retryable, because it does not depend on the policy at all.
    await expect(deliver(fraudCheckV1.type, asked)).resolves.toMatchObject({
      outcome: 'produced',
    });
  }, 120_000);

  it('does attempt again what a fault said another attempt might fix', async () => {
    // The payment gateway did not answer, and may on the next attempt.
    const asked = createArvoEventFactory(paymentChargeV1).createInput({
      source: 'com.test.abandonment',
      subject: `abandon-retryable-${Date.now()}`,
      to: paymentChargeV1.type,
      data: { amount: 42, currency: 'GBP', failuresBeforeSuccess: 2 },
    });

    const raised = await deliver(paymentChargeV1.type, asked)
      .then(() => null)
      .catch((failure: unknown) => failure);

    // thrown, so Temporal makes the next attempt, after the delay the
    // fault asked for rather than one a policy invented
    expect(raised).toBeInstanceOf(ApplicationFailure);
    const failure = raised as ApplicationFailure;
    expect(failure.type).toBe('executor_raised');
    expect(failure.nonRetryable).toBe(false);
    expect(failure.nextRetryDelay).toBeDefined();
  }, 120_000);

  // ------------------------------------------- a fault carrying the event alone

  it('sends the event alone where there was no record to keep it with', async () => {
    // A payload the contract refuses, so the delivery fails at the gate
    // before a record could be built. The fault carries an event for the
    // caller and no record, and there is nothing for that event to be
    // kept together with.
    const malformed = createArvoEvent({
      source: 'com.test.abandonment',
      subject: `abandon-event-only-${Date.now()}`,
      to: fraudCheckV1.type,
      type: fraudCheckV1.type,
      dataschema: fraudCheckV1.dataschema,
      data: { orderRef: 42 },
    });

    const report = await deliver(fraudCheckV1.type, malformed);

    expect(report.outcome).toBe('produced');
    // the event, and no revision anywhere
    expect(report.emitted.map((one) => one.eventType)).toEqual([
      'handler_com_fraud_check_error',
    ]);
    expect(
      await revisionsOf(harness.client, await deriveArvoExecutionId(malformed)),
    ).toEqual([]);
  }, 120_000);

  // ----------------------------------------------- a fault carrying neither

  // ------------------------------------------ where a person has to find it

  it('fails the delivery where nothing can carry the event at all', async () => {
    // An event addressed to something no handler implements. Not a
    // failure of the work — a failure of whoever routed it — so no
    // attempt helps, and the delivery itself is what records that.
    const misaddressed = createArvoEvent({
      source: 'com.test.abandonment',
      subject: `abandon-nowhere-${Date.now()}`,
      to: 'com.nobody.implements.this',
      type: fraudCheckV1.type,
      dataschema: fraudCheckV1.dataschema,
      data: { orderRef: 'order-abandon-3' },
    });

    const raised = await deliver(fraudCheckV1.type, misaddressed)
      .then(() => null)
      .catch((failure: unknown) => failure);

    expect(raised).toBeInstanceOf(ApplicationFailure);
    const failure = raised as ApplicationFailure;
    expect(failure.type).toBe('arvo_unroutable');
    // non-retryable, so the delivery's workflow comes to rest as failed
    // with the reason in its history — which is where a person looks
    expect(failure.nonRetryable).toBe(true);
    expect(failure.message).toContain('com.nobody.implements.this');
  }, 120_000);

  it('sends nothing where the execution had already answered', async () => {
    // A walk with nothing below it answers on the delivery that opens
    // it, so it comes to rest at once.
    const asked = createArvoEventFactory(categoryWalkV1).createInput({
      source: 'com.test.abandonment',
      subject: `abandon-neither-${Date.now()}`,
      to: categoryWalkV1.type,
      data: { category: 'orders/branch-1/shelf-1/bin-1', remaining: 0 },
    });
    const executionId = await deriveArvoExecutionId(asked);

    const opened = await deliver(categoryWalkV1.type, asked);
    expect(opened.lifecycle).toBe('success');

    // An answer arriving for an execution that is already finished. It
    // told its caller once; a second telling would overwrite how it
    // ended, so the fault carries neither half.
    const late = createArvoEvent({
      source: categoryWalkV1.type,
      subject: asked.subject,
      to: categoryWalkV1.type,
      type: 'evt_category_walked',
      dataschema: categoryWalkV1.dataschema,
      category: ARVO_CATEGORY_COMPLETE,
      executionid: executionId,
      initid: asked.id,
      parentid: asked.id,
      data: { category: 'orders', visited: 1, deepest: 0 },
    });

    const report = await deliver(categoryWalkV1.type, late);

    expect(report.outcome).toBe('nothing');
    expect(report.emitted).toEqual([]);
    // and for that reason rather than another: `nothing` alone would
    // also be what a repeat looks like
    expect(report.note).toContain('lifecycle_terminal');
    // nothing was written, so how it ended still stands
    const revisions = await revisionsOf(harness.client, executionId);
    expect(revisions).toHaveLength(1);
    expect(revisions[0]?.state.lifecycle).toBe('success');
  }, 180_000);
});
