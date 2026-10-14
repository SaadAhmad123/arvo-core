import {
  ArvoEventSerializer,
  createArvoEventFactory,
  deriveArvoExecutionId,
} from 'arvo-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inventoryCheckV1 } from '../../../src/distributed/handler/com_inventory_check/contract.js';
import { storeFor } from '../../../src/distributed/shared/record-store.js';
import { type DbosHarness, startDbosHarness } from './harness.js';

/**
 * Obligation 5, against DBOS.
 *
 * > Writes to one execution record MUST be serialized. A mechanism MUST
 * > commit at `cas_version` `0` only where no record exists.
 *
 * DBOS gets neither for free. Temporal orders writes structurally — one
 * workflow per execution is a lock — while here every delivery is a
 * writer against one table, so both halves are constraints in the
 * schema: a primary key for the first, a trigger for the rest. That is
 * deliberate, and it is why they are in the database rather than in
 * application code that remembers to be careful.
 *
 * The last test is about what this does **not** buy, which is the part
 * worth saying out loud.
 *
 * Needs the stack up and migrated.
 */

const WIRE = new ArvoEventSerializer({ type: 'arvoevent' });

/** An item this spec has to itself, so another run cannot move its stock. */
const stockFor = (sku: string, held: number) =>
  `INSERT INTO catalogue (sku, category, held) VALUES ('${sku}', 'orders/dbos-raced', ${held})
   ON CONFLICT (sku) DO UPDATE SET held = ${held}`;

describe('writes to one record', () => {
  let harness: DbosHarness;

  beforeAll(async () => {
    harness = await startDbosHarness('arvo-dbos-serialized-spec');
  }, 120_000);

  afterAll(async () => {
    await harness?.stop();
  }, 60_000);

  const aCheck = (subject: string, sku: string) =>
    createArvoEventFactory(inventoryCheckV1).createInput({
      source: 'com.test.serialized',
      subject,
      to: inventoryCheckV1.type,
      data: { sku, wanted: 1 },
    });

  const deliver = async (payload: string) => {
    const step = harness.steps[inventoryCheckV1.type];
    if (step === undefined) throw new Error('no step for the handler');
    return step(payload);
  };

  it('creates a first revision only where none exists', async () => {
    // A unique constraint, not a read-then-write: a read-then-write is
    // only a lock if every writer agrees to take it.
    const store = storeFor(harness.pool);
    const executionId = `${Date.now().toString(16)}${'a'.repeat(64)}`.slice(
      0,
      64,
    );
    const record = {
      executionId,
      casVersion: 0,
      subject: `dbos-first-${Date.now()}`,
      source: inventoryCheckV1.type,
      version: '1.0.0',
      lifecycle: 'waiting',
    };

    expect((await store.commit({ record, events: [] })).committed).toBe(true);

    const second = await store.commit({ record, events: [] });
    expect(second.committed).toBe(false);
    expect(second.committed === false && second.because).toBe('revision_taken');
  }, 120_000);

  it('refuses a revision that does not follow the one before it', async () => {
    const store = storeFor(harness.pool);
    const executionId = `${Date.now().toString(16)}${'b'.repeat(64)}`.slice(
      0,
      64,
    );
    const at = (casVersion: number) => ({
      executionId,
      casVersion,
      subject: `dbos-sequence-${Date.now()}`,
      source: inventoryCheckV1.type,
      version: '1.0.0',
      lifecycle: 'waiting',
    });

    expect((await store.commit({ record: at(0), events: [] })).committed).toBe(
      true,
    );

    // Refused by the database rather than by this code: the trigger is
    // what every writer meets, including one that never read.
    const skipped = await store.commit({ record: at(2), events: [] });
    expect(skipped.committed).toBe(false);
    expect(skipped.committed === false && skipped.because).toBe(
      'revision_out_of_sequence',
    );
  }, 120_000);

  it('lets exactly one of two opening deliveries create the record', async () => {
    const sku = `sku-dbos-one-${Date.now()}`;
    await harness.pool.query(stockFor(sku, 10));

    const asked = aCheck(`dbos-two-openings-${Date.now()}`, sku);
    const executionId = await deriveArvoExecutionId(asked);
    const payload = await WIRE.serialize(asked);

    const [one, two] = await Promise.allSettled([
      deliver(payload),
      deliver(payload),
    ]);

    // exactly one record, as obligation 5 requires
    const revisions = await harness.pool.query(
      'SELECT cas_version FROM execution_record WHERE execution_id = $1',
      [executionId],
    );
    expect(revisions.rowCount).toBe(1);

    // and exactly one of them produced it
    const produced = [one, two].filter(
      (settled) =>
        settled.status === 'fulfilled' && settled.value.outcome === 'produced',
    );
    expect(produced).toHaveLength(1);
  }, 180_000);

  it('makes the loser of a race publish what was committed rather than nothing', async () => {
    // Losing takes two forms. Where a revision names this delivery's
    // triggering event it already succeeded once, and what the world is
    // told is what it committed then — not nothing, which would drop the
    // event, and not something produced again.
    const sku = `sku-dbos-converge-${Date.now()}`;
    await harness.pool.query(stockFor(sku, 10));

    const asked = aCheck(`dbos-converge-${Date.now()}`, sku);
    const payload = await WIRE.serialize(asked);

    const first = await deliver(payload);
    expect(first.outcome).toBe('produced');

    const losing = await deliver(payload);
    expect(losing.outcome).toBe('recovered');
    expect(losing.emitted).toEqual(first.emitted);
  }, 180_000);

  it('does not stop both racing executors from running, and says so', async () => {
    /**
     * This is what compare-and-swap does not buy, and the protocol says
     * it does not. Two deliveries of one event both find no record, both
     * enter the executor, and both do what the executor does outside
     * Arvo. One revision is committed; both executors ran.
     *
     * What keeps the stock right is therefore not the record. It is the
     * key the executor passed: both reservations claim one delivery key,
     * the second loses to a primary key, and the item moves once. The
     * last assertion proves the record did nothing about it — a second
     * reservation under a different key takes stock again, which is the
     * failure this handler would still have if it passed no key.
     */
    const sku = `sku-dbos-raced-${Date.now()}`;
    await harness.pool.query(stockFor(sku, 10));

    const asked = aCheck(`dbos-both-ran-${Date.now()}`, sku);
    const executionId = await deriveArvoExecutionId(asked);
    const payload = await WIRE.serialize(asked);

    await Promise.allSettled([deliver(payload), deliver(payload)]);

    expect(
      (
        await harness.pool.query(
          'SELECT cas_version FROM execution_record WHERE execution_id = $1',
          [executionId],
        )
      ).rowCount,
    ).toBe(1);

    const heldOf = async () =>
      (
        await harness.pool.query<{ held: number }>(
          'SELECT held FROM catalogue WHERE sku = $1',
          [sku],
        )
      ).rows[0]?.held;

    // the stock moved once, though both executors reserved it: one
    // delivery key, claimed once
    expect(await heldOf()).toBe(9);
    expect(
      (
        await harness.pool.query('SELECT 1 FROM reservation WHERE sku = $1', [
          sku,
        ])
      ).rowCount,
    ).toBe(1);

    // and nothing about the record is what did that
    await harness.pool.query(
      `INSERT INTO reservation (idempotency_key, sku, taken) VALUES ($1, $2, 1)`,
      [`not-the-executors-key-${Date.now()}`, sku],
    );
    await harness.pool.query(
      'UPDATE catalogue SET held = held - 1 WHERE sku = $1',
      [sku],
    );
    expect(await heldOf()).toBe(8);
  }, 180_000);
});
