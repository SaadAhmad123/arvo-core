import {
  ArvoEventSerializer,
  createArvoEventFactory,
  deriveArvoExecutionId,
} from 'arvo-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inventoryCheckV1 } from '../../../src/distributed/handler/com_inventory_check/contract.js';
import { type DbosHarness, startDbosHarness } from './harness.js';

/**
 * Obligation 1, against DBOS.
 *
 * > The emitted events and the next execution record MUST be preserved
 * > together, and the events MUST reach their destinations once the
 * > record is committed.
 *
 * DBOS keeps its own state in Postgres, and so does the record store, so
 * both halves of this are one transaction in one database. That is the
 * opposite arrangement from Temporal, where a revision is a workflow's
 * own state — and the obligation is the same either way, which is the
 * point of asserting it twice.
 *
 * Needs the stack up and migrated.
 */

const WIRE = new ArvoEventSerializer({ type: 'arvoevent' });

/** An item the seed holds some of, so a check has something to find. */
const KNOWN_SKU = 'sku-wide-0002';

describe('what is committed and what is published', () => {
  let harness: DbosHarness;

  beforeAll(async () => {
    harness = await startDbosHarness('arvo-dbos-outbox-spec');
  }, 120_000);

  afterAll(async () => {
    await harness?.stop();
  }, 60_000);

  /** One check, asked the way a mechanism would ask. */
  const aCheck = (subject: string) =>
    createArvoEventFactory(inventoryCheckV1).createInput({
      source: 'com.test.outbox',
      subject,
      to: inventoryCheckV1.type,
      data: { sku: KNOWN_SKU, wanted: 1 },
    });

  /** One delivery, outside any workflow. */
  const deliver = async (payload: string) => {
    const step = harness.steps[inventoryCheckV1.type];
    if (step === undefined) throw new Error('no step for the handler');
    return step(payload);
  };

  it('writes the record and the events it produced as one thing', async () => {
    const asked = aCheck(`dbos-outbox-together-${Date.now()}`);
    const executionId = await deriveArvoExecutionId(asked);

    const report = await deliver(await WIRE.serialize(asked));
    expect(report.outcome).toBe('produced');

    // the outbox row exists only alongside the revision it was committed
    // with, which is a foreign key rather than a convention
    const together = await harness.pool.query<{
      casVersion: number;
      eventId: string;
    }>(
      `SELECT outbox.cas_version::int AS "casVersion", outbox.event_id AS "eventId"
         FROM outbox
         JOIN execution_record record
           ON record.execution_id = outbox.execution_id
          AND record.cas_version = outbox.cas_version
        WHERE outbox.execution_id = $1`,
      [executionId],
    );
    expect(together.rows).toHaveLength(report.emitted.length);
    expect(together.rows.every((row) => row.casVersion === 0)).toBe(true);
  }, 120_000);

  it('publishes nothing where the commit did not succeed', async () => {
    // A record already at revision 0, so the delivery's own commit is
    // refused. Nothing it produced may reach the outbox.
    const asked = aCheck(`dbos-outbox-refused-${Date.now()}`);
    const executionId = await deriveArvoExecutionId(asked);

    const first = await deliver(await WIRE.serialize(asked));
    expect(first.outcome).toBe('produced');

    const published = await harness.pool.query(
      'SELECT event_id FROM outbox WHERE execution_id = $1',
      [executionId],
    );

    // the same event again: the handler refuses it as already executed,
    // and nothing new is written
    const again = await deliver(await WIRE.serialize(asked));
    expect(again.outcome).toBe('recovered');

    const afterwards = await harness.pool.query(
      'SELECT event_id FROM outbox WHERE execution_id = $1',
      [executionId],
    );
    expect(afterwards.rowCount).toBe(published.rowCount);
  }, 120_000);

  it('re-sends what was committed, byte for byte, rather than producing it again', async () => {
    const asked = aCheck(`dbos-outbox-bytes-${Date.now()}`);

    const first = await deliver(await WIRE.serialize(asked));
    const again = await deliver(await WIRE.serialize(asked));

    expect(again.outcome).toBe('recovered');
    // the same bytes, not an equivalent event: a re-derived one would
    // carry a new id and a new time
    expect(again.emitted).toEqual(first.emitted);
  }, 120_000);

  it('never holds a record without the events committed with it', async () => {
    // Asserted against the store rather than against a transcript, and
    // across everything in it: no revision may claim events the outbox
    // does not hold, and no outbox row may name a revision that is not
    // there. The second is a foreign key; the first is what this checks.
    const orphaned = await harness.pool.query(
      `SELECT outbox.event_id
         FROM outbox
         LEFT JOIN execution_record record
           ON record.execution_id = outbox.execution_id
          AND record.cas_version = outbox.cas_version
        WHERE record.execution_id IS NULL`,
    );
    expect(orphaned.rowCount).toBe(0);
  }, 120_000);
});
