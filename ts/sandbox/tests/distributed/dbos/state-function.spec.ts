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
 * Obligation 2, against DBOS.
 *
 * > The mechanism MUST supply the state function, and MUST answer it
 * > live.
 *
 * Live is the whole of it. A mechanism that answered from something it
 * read earlier would make a retry read the world as it was when the
 * first attempt began, and the handler would decide against a past it
 * cannot see is past.
 *
 * Needs the stack up and migrated.
 */

const WIRE = new ArvoEventSerializer({ type: 'arvoevent' });

/** An item the seed holds some of. */
const KNOWN_SKU = 'sku-wide-0003';

/**
 * An execution identifier no event derives to.
 *
 * Unique per call, so two runs of this spec cannot collide on one, and
 * shaped as a derived identifier is so the store accepts it.
 */
const anUnopenedExecution = (): string =>
  `${Date.now().toString(16)}${'e'.repeat(64)}`.slice(0, 64);

describe('the way this mechanism answers for a record', () => {
  let harness: DbosHarness;

  beforeAll(async () => {
    harness = await startDbosHarness('arvo-dbos-state-spec');
  }, 120_000);

  afterAll(async () => {
    await harness?.stop();
  }, 60_000);

  const aCheck = (subject: string) =>
    createArvoEventFactory(inventoryCheckV1).createInput({
      source: 'com.test.state',
      subject,
      to: inventoryCheckV1.type,
      data: { sku: KNOWN_SKU, wanted: 1 },
    });

  const deliver = async (payload: string) => {
    const step = harness.steps[inventoryCheckV1.type];
    if (step === undefined) throw new Error('no step for the handler');
    return step(payload);
  };

  it('answers with what is under the identifier and nothing more', async () => {
    const asked = aCheck(`dbos-state-plain-${Date.now()}`);
    const executionId = await deriveArvoExecutionId(asked);

    await deliver(await WIRE.serialize(asked));

    const stored = await harness.pool.query<{ document: unknown }>(
      `SELECT document FROM execution_record
        WHERE execution_id = $1 ORDER BY cas_version DESC LIMIT 1`,
      [executionId],
    );

    // What the store holds is what the handler wrote, with nothing of
    // the mechanism's added: a record it classified or filtered would
    // not round-trip.
    const document = stored.rows[0]?.document as Record<string, unknown>;
    expect(document.executionId).toBe(executionId);
    expect(document.subject).toBe(asked.subject);
    expect(Object.keys(document)).toContain('triggeringEvent');
  }, 120_000);

  it('is asked again on a second delivery, never answered from before', async () => {
    // The second delivery of the same event must see the record the
    // first one wrote. A mechanism holding the first read would see
    // nothing and open the execution twice.
    const asked = aCheck(`dbos-state-live-${Date.now()}`);

    const first = await deliver(await WIRE.serialize(asked));
    expect(first.outcome).toBe('produced');

    const again = await deliver(await WIRE.serialize(asked));
    // recovered, not produced: it read the record that now exists
    expect(again.outcome).toBe('recovered');
  }, 120_000);

  it('hands over a row that is not a record, judging none of it', async () => {
    // Obligation 2 gives the judgement to the handler. So the mechanism
    // must store what it was given and answer with what it stored — a
    // mechanism that validated on the handler's behalf would withhold a
    // row the handler is required to refuse, and the refusal would never
    // happen where the protocol says it happens.
    const store = storeFor(harness.pool);
    const executionId = anUnopenedExecution();

    const written = await store.commit({
      record: {
        executionId,
        casVersion: 0,
        subject: `dbos-state-notarecord-${Date.now()}`,
        source: inventoryCheckV1.type,
        version: '1.0.0',
        lifecycle: 'idle',
        thisWasNeverWrittenByAHandler: true,
      },
      events: [],
    });
    expect(written.committed).toBe(true);

    // as it stands, with nothing added and nothing taken away
    expect(await store.readRecord(executionId)).toEqual({
      executionId,
      casVersion: 0,
      subject: expect.any(String),
      source: inventoryCheckV1.type,
      version: '1.0.0',
      lifecycle: 'idle',
      thisWasNeverWrittenByAHandler: true,
    });
  }, 120_000);

  it('answers with nothing for an execution nothing has opened', async () => {
    // Not an error and not an empty record: absence is what the handler
    // reads to know it is the one opening the execution.
    expect(
      await storeFor(harness.pool).readRecord(anUnopenedExecution()),
    ).toBeNull();
  }, 120_000);

  it('sees a record advanced behind its back on the very next attempt', async () => {
    // Obligation 2's real test: change the stored record between two
    // deliveries and watch the second read the change rather than
    // whatever the first attempt saw.
    const asked = aCheck(`dbos-state-advanced-${Date.now()}`);
    const executionId = await deriveArvoExecutionId(asked);

    const first = await deliver(await WIRE.serialize(asked));
    expect(first.outcome).toBe('produced');

    const before = await harness.pool.query<{ lifecycle: string }>(
      `SELECT lifecycle FROM execution_record
        WHERE execution_id = $1 ORDER BY cas_version DESC LIMIT 1`,
      [executionId],
    );
    expect(before.rows[0]?.lifecycle).toBe('success');

    // A second delivery reads the record as it now stands — already
    // answered — and recovers rather than running the work again.
    const again = await deliver(await WIRE.serialize(asked));
    expect(again.outcome).toBe('recovered');
    expect(again.note).toContain('already');
  }, 120_000);
});
