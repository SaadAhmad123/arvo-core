import {
  ArvoEventSerializer,
  createArvoEvent,
  createArvoEventFactory,
  deriveArvoExecutionId,
} from 'arvo-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fraudCheckV1 } from '../../../src/distributed/handler/com_fraud_check/contract.js';
import { inventoryCheckV1 } from '../../../src/distributed/handler/com_inventory_check/contract.js';
import { type DbosHarness, startDbosHarness } from './harness.js';

/**
 * Obligation 3, against DBOS.
 *
 * > A mechanism that abandons an execution MUST do so with the fault's
 * > `abandonment_state` and `abandonment_event`, together, and with
 * > nothing of its own.
 *
 * A fault carries both halves, the event alone, or neither, and each is
 * acted on as it stands. ADR-008 names the fourth case — an opening
 * event for an execution that already exists — as the one a mechanism is
 * most likely to read as a failure, so that is asserted too.
 *
 * Needs the stack up and migrated.
 */

const WIRE = new ArvoEventSerializer({ type: 'arvoevent' });

describe('giving up on an execution', () => {
  let harness: DbosHarness;

  beforeAll(async () => {
    harness = await startDbosHarness('arvo-dbos-abandonment-spec');
  }, 120_000);

  afterAll(async () => {
    await harness?.stop();
  }, 60_000);

  /** One delivery to whichever handler is named, outside any workflow. */
  const deliver = async (contractType: string, payload: string) => {
    const step = harness.steps[contractType];
    if (step === undefined) throw new Error(`no step for ${contractType}`);
    return step(payload);
  };

  it('commits the record and the event the fault carried, together', async () => {
    // The fraud check says no attempt will fix it, and it has a record
    // by the time it says so — so the fault carries both halves.
    const asked = createArvoEventFactory(fraudCheckV1).createInput({
      source: 'com.test.abandonment',
      subject: `dbos-abandon-both-${Date.now()}`,
      to: fraudCheckV1.type,
      data: { orderRef: 'order-abandon-1' },
    });
    const executionId = await deriveArvoExecutionId(asked);

    const report = await deliver(
      fraudCheckV1.type,
      await WIRE.serialize(asked),
    );

    // returned, not thrown: the delivery did what the protocol asked of
    // it, and marking it failed would make a correct abandonment look
    // like a broken worker
    expect(report.outcome).toBe('produced');
    expect(report.note).toContain('no fraud model is deployed');

    const revisions = await harness.pool.query<{
      lifecycle: string;
      casVersion: number;
    }>(
      `SELECT lifecycle, cas_version::int AS "casVersion"
         FROM execution_record WHERE execution_id = $1`,
      [executionId],
    );
    expect(revisions.rows).toHaveLength(1);
    expect(revisions.rows[0]?.lifecycle).toBe('failure');

    // both halves in one revision, and the event is the one the fault
    // carried rather than one this mechanism composed
    const committed = await harness.pool.query<{
      eventType: string;
      payload: string;
    }>(
      `SELECT event_type AS "eventType", payload FROM outbox
        WHERE execution_id = $1 AND cas_version = 0`,
      [executionId],
    );
    expect(committed.rows.map((row) => row.eventType)).toEqual([
      'handler_com_fraud_check_error',
    ]);
    expect(report.emitted).toEqual(committed.rows.map((row) => row.payload));
  }, 120_000);

  it('does not attempt again what a fault said no attempt would fix', async () => {
    // Nothing is thrown at all, so the step's retry policy has nothing
    // to act on. That is a stronger guarantee than a failure marked
    // non-retryable: there is no failure.
    const asked = createArvoEventFactory(fraudCheckV1).createInput({
      source: 'com.test.abandonment',
      subject: `dbos-abandon-once-${Date.now()}`,
      to: fraudCheckV1.type,
      data: { orderRef: 'order-abandon-2' },
    });
    const executionId = await deriveArvoExecutionId(asked);

    await deliver(fraudCheckV1.type, await WIRE.serialize(asked));

    const revisions = await harness.pool.query(
      'SELECT cas_version FROM execution_record WHERE execution_id = $1',
      [executionId],
    );
    // one revision, so the executor was entered once
    expect(revisions.rowCount).toBe(1);
  }, 120_000);

  it('sends the event alone where there was no record to keep it with', async () => {
    // An event the handler cannot classify at all: there is no record to
    // carry forward, so the fault carries the event on its own.
    const malformed = createArvoEvent({
      source: 'com.test.abandonment',
      subject: `dbos-abandon-alone-${Date.now()}`,
      type: 'com_fraud_check',
      to: fraudCheckV1.type,
      dataschema: '#/com/fraud/check/9.9.9',
      data: { orderRef: 'order-abandon-3' },
    });

    const report = await deliver(
      fraudCheckV1.type,
      await WIRE.serialize(malformed),
    );

    // nothing committed, because there is no record to commit
    expect(report.lifecycle).toBeNull();
    // and whatever the fault carried is what a person is left with
    const parked = await harness.pool.query<{ why: string }>(
      'SELECT why FROM needs_a_person WHERE subject = $1',
      [malformed.subject],
    );
    expect(parked.rows[0]?.why).toBe('nothing_will_retry');
  }, 120_000);

  it('does not read an opening event for an existing execution as a failure', async () => {
    // ADR-008 names this as the case a mechanism is most likely to get
    // wrong. It is a redelivery: the work succeeded, and publishing a
    // handler error for it would tell the caller the opposite.
    const asked = createArvoEventFactory(inventoryCheckV1).createInput({
      source: 'com.test.abandonment',
      subject: `dbos-abandon-redelivered-${Date.now()}`,
      to: inventoryCheckV1.type,
      data: { sku: 'sku-wide-0004', wanted: 1 },
    });

    const first = await deliver(
      inventoryCheckV1.type,
      await WIRE.serialize(asked),
    );
    expect(first.outcome).toBe('produced');

    const again = await deliver(
      inventoryCheckV1.type,
      await WIRE.serialize(asked),
    );
    // recovered rather than failed, and carrying what the first
    // delivery committed rather than nothing
    expect(again.outcome).toBe('recovered');
    expect(again.emitted).toEqual(first.emitted);
  }, 120_000);

  it('leaves a fault nothing will retry where a person can find it', async () => {
    // Somewhere is not one place. Where the fault carried a record, the
    // record is where a person finds it: committed at `failure`, with
    // the reason on it, and the caller told by the event committed
    // alongside. Nothing is parked, because nothing was stranded.
    //
    // The table is for the other case — an event that reaches nobody —
    // and the two must not be conflated, or every abandonment ends up in
    // a queue of things to look at that are already accounted for.
    const asked = createArvoEventFactory(fraudCheckV1).createInput({
      source: 'com.test.abandonment',
      subject: `dbos-abandon-poison-${Date.now()}`,
      to: fraudCheckV1.type,
      data: { orderRef: 'order-abandon-4' },
    });
    const executionId = await deriveArvoExecutionId(asked);

    const report = await deliver(
      fraudCheckV1.type,
      await WIRE.serialize(asked),
    );

    const resting = await harness.pool.query<{
      lifecycle: string;
      because: string;
    }>(
      `SELECT lifecycle, document->>'lifecycleDescription' AS because
         FROM execution_record WHERE execution_id = $1`,
      [executionId],
    );
    expect(resting.rows[0]?.lifecycle).toBe('failure');
    expect(resting.rows[0]?.because).toContain('no fraud model is deployed');

    // and the caller was told, in the same revision
    expect(report.emitted).toHaveLength(1);

    // so nothing is waiting for a person: it is accounted for
    const parked = await harness.pool.query(
      'SELECT why FROM needs_a_person WHERE subject = $1',
      [asked.subject],
    );
    expect(parked.rowCount).toBe(0);
  }, 120_000);
});
