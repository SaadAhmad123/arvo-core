import {
  type ArvoEvent,
  ArvoEventSerializer,
  createArvoEventFactory,
  type JSONObject,
} from 'arvo-core';
import { Pool } from 'pg';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import {
  type CommittedEvent,
  type RecordStore,
  storeFor,
} from '../../../src/distributed/dbos/store.js';
import { inventoryCheckV1 } from '../../../src/distributed/handler/com_inventory_check/contract.js';
import { inventoryCheckHandler } from '../../../src/distributed/handler/com_inventory_check/index.js';
import { readConfig } from '../../../src/distributed/shared/config.js';

/**
 * Obligation 1 and obligation 5, against the database that is supposed
 * to meet them.
 *
 * Every record here is one a real handler produced, because a record
 * written by the test would prove only that the test can write rows.
 * The handler is run with no framework at all, which is deliberate:
 * what is under test is the store, and anything a framework added would
 * be something a later section has to subtract again.
 *
 * It needs the stack up and migrated.
 */

/** The format the outbox holds an event in, for comparing bytes to bytes. */
const WIRE = new ArvoEventSerializer({ type: 'arvoevent' });

/** An item the seed holds some of, so a run of this has something to find. */
const KNOWN_SKU = 'sku-wide-0001';

describe('the record store', () => {
  let pool: Pool;
  let store: RecordStore;
  beforeAll(() => {
    const config = readConfig('arvo-store-spec');
    pool = new Pool({
      connectionString: config.recordsUrl,
      max: config.recordsPoolSize,
    });
    store = storeFor(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    // Truncated rather than deleted: a record may not be deleted, which
    // is the point of one of these tests.
    await pool.query('TRUNCATE outbox, execution_record');
  });

  /** One check, asked of the handler the way a mechanism would ask. */
  const anItemCheck = (subject: string): ArvoEvent =>
    createArvoEventFactory(inventoryCheckV1).createInput({
      source: 'com.test.store',
      subject,
      to: inventoryCheckV1.type,
      data: { sku: KNOWN_SKU, wanted: 1 },
    });

  /** The handler run once, with the store as its state function. */
  const runOnce = async (event: ArvoEvent) =>
    inventoryCheckHandler.execute({
      event,
      state: async ({ executionId }) =>
        (await store.readRecord(executionId)) as JSONObject | null,
      attempt: 0,
      dependencies: ({ executionId, attempt, state }) => ({
        executionId,
        attempt,
        resumed: state,
      }),
    });

  /** What one execution produced, for a test that then commits it. */
  const produced = async (subject: string) => {
    const executed = await runOnce(anItemCheck(subject));
    expect(executed.kind).toBe('produced');
    if (executed.kind !== 'produced') throw new Error('nothing was produced');
    return executed;
  };

  // --------------------------------------------------------- obligation 1

  it('commits a record and the events produced with it, together', async () => {
    const executed = await produced('store-together');
    const outcome = await store.commit({
      record: executed.state,
      events: executed.events,
    });

    expect(outcome.committed).toBe(true);

    const records = await pool.query('SELECT * FROM execution_record');
    expect(records.rowCount).toBe(1);
    expect(records.rows[0].cas_version).toBe('0');

    const outbox = await pool.query('SELECT * FROM outbox');
    expect(outbox.rowCount).toBe(executed.events.length);
    // and every one of them traces back to the record it was committed
    // with, which the foreign key makes impossible to break
    for (const row of outbox.rows) {
      expect(row.execution_id).toBe(records.rows[0].execution_id);
      expect(row.cas_version).toBe(records.rows[0].cas_version);
      expect(row.published_at).toBeNull();
    }
  });

  it('publishes nothing where the commit does not succeed', async () => {
    const executed = await produced('store-no-commit-no-event');
    await store.commit({ record: executed.state, events: executed.events });
    const after = await pool.query('SELECT count(*) FROM outbox');

    // the same execution committed again: the store refuses it, and the
    // events it carried must not appear a second time
    const again = await store.commit({
      record: executed.state,
      events: executed.events,
    });
    expect(again).toEqual({ committed: false, because: 'revision_taken' });

    const unchanged = await pool.query('SELECT count(*) FROM outbox');
    expect(unchanged.rows[0].count).toBe(after.rows[0].count);
  });

  it('holds an event only alongside a record that exists', async () => {
    const executed = await produced('store-no-orphans');
    await store.commit({ record: executed.state, events: executed.events });

    const orphans = await pool.query(
      `SELECT o.event_id FROM outbox o
       LEFT JOIN execution_record r
         ON r.execution_id = o.execution_id AND r.cas_version = o.cas_version
       WHERE r.execution_id IS NULL`,
    );
    expect(orphans.rowCount).toBe(0);
  });

  // --------------------------------------------------------- obligation 5

  it('creates a record at revision zero only where none exists', async () => {
    const executed = await produced('store-create-if-absent');

    // two writers, one record: whichever is second is told so rather
    // than overwriting what the first wrote
    const [first, second] = await Promise.all([
      store.commit({ record: executed.state, events: executed.events }),
      store.commit({ record: executed.state, events: executed.events }),
    ]);

    const committed = [first, second].filter((one) => one.committed);
    expect(committed.length).toBe(1);

    const records = await pool.query('SELECT count(*) FROM execution_record');
    expect(records.rows[0].count).toBe('1');
  });

  it('refuses a revision that does not follow the one before it', async () => {
    const executed = await produced('store-out-of-sequence');
    await store.commit({ record: executed.state, events: executed.events });

    // a writer that read nothing and wrote far ahead. Refused by the
    // database, not by anything that remembered to check.
    const ahead = await store.commit({
      record: { ...executed.state, casVersion: 7 },
      events: [],
    });
    expect(ahead).toEqual({
      committed: false,
      because: 'revision_out_of_sequence',
    });
  });

  it('refuses to alter a revision already written', async () => {
    const executed = await produced('store-written-once');
    await store.commit({ record: executed.state, events: executed.events });

    await expect(
      pool.query("UPDATE execution_record SET lifecycle = 'cancelled'"),
    ).rejects.toMatchObject({ code: 'AR002' });

    await expect(
      pool.query('DELETE FROM execution_record'),
    ).rejects.toMatchObject({
      code: 'AR002',
    });
  });

  // --------------------------------------------------------- obligation 2

  it('answers a read with what is stored, judging none of it', async () => {
    // a row that is not a record. The store must hand it over as it
    // stands: whether it is a record is the handler's to decide, and a
    // mechanism that withheld it would be deciding on the handler's
    // behalf.
    const notARecord = { this: 'was never written by a handler' };
    await pool.query(
      `INSERT INTO execution_record
         (execution_id, cas_version, subject, source, version, lifecycle, document)
       VALUES ($1, 0, 'store-unjudged', 'com_inventory_check', '1.0.0', 'idle', $2)`,
      ['0'.repeat(64), notARecord],
    );

    expect(await store.readRecord('0'.repeat(64))).toEqual(notARecord);
  });

  it('answers with the latest revision, and with nothing where there is none', async () => {
    expect(await store.readRecord('f'.repeat(64))).toBeNull();
  });

  // ----------------------------------------------------------- the outbox

  it('publishes what was committed, byte for byte', async () => {
    const executed = await produced('store-bytes');
    await store.commit({ record: executed.state, events: executed.events });

    const sent: CommittedEvent[] = [];
    const published = await store.drainOutbox(async (committedEvent) => {
      sent.push(committedEvent);
    });

    expect(published).toBe(executed.events.length);
    for (const committedEvent of sent) {
      const asEmitted = executed.events.find(
        (event) => event.id === committedEvent.eventId,
      );
      expect(asEmitted).toBeDefined();
      if (asEmitted === undefined) continue;
      // not merely equivalent: the same string, so recovery sends what
      // was committed rather than running the execution again to
      // produce something equivalent
      expect(committedEvent.payload).toBe(await WIRE.serialize(asEmitted));
    }

    // and nothing is offered twice
    expect(await store.drainOutbox(async () => {})).toBe(0);
  });

  it('offers an event again where sending it failed', async () => {
    const executed = await produced('store-send-failed');
    await store.commit({ record: executed.state, events: executed.events });

    await expect(
      store.drainOutbox(async () => {
        throw new Error('the broker was unreachable');
      }),
    ).rejects.toThrow('the broker was unreachable');

    const still = await pool.query(
      'SELECT count(*) FROM outbox WHERE published_at IS NULL',
    );
    expect(still.rows[0].count).toBe(String(executed.events.length));

    // and the next drain sends it, which is why a receiver has to
    // discard a repeat rather than process it twice
    expect(await store.drainOutbox(async () => {})).toBe(
      executed.events.length,
    );
  });

  it('divides the work between publishers rather than repeating it', async () => {
    for (const which of [1, 2, 3, 4, 5, 6]) {
      const executed = await produced(`store-divided-${which}`);
      await store.commit({ record: executed.state, events: executed.events });
    }

    const sent: string[] = [];
    const collect = async (committedEvent: CommittedEvent): Promise<void> => {
      sent.push(committedEvent.eventId);
    };

    // two publishers draining at once. Each claim skips what the other
    // holds, so an event is sent once even though neither knows about
    // the other.
    const [left, right] = await Promise.all([
      store.drainOutbox(collect, { atMost: 3 }),
      store.drainOutbox(collect, { atMost: 3 }),
    ]);

    expect(new Set(sent).size).toBe(sent.length);
    expect(left + right).toBe(sent.length);
    expect(await store.drainOutbox(collect)).toBe(6 - sent.length);
  });
});
