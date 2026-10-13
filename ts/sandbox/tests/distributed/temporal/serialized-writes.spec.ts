import { ApplicationFailure } from '@temporalio/activity';
import { MockActivityEnvironment } from '@temporalio/testing';
import {
  type ArvoEvent,
  ArvoEventSerializer,
  createArvoEventFactory,
  deriveArvoExecutionId,
} from 'arvo-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { categoryWalkV1 } from '../../../src/distributed/handler/com_category_walk/contract.js';
import { inventoryCheckV1 } from '../../../src/distributed/handler/com_inventory_check/contract.js';
import { createActivities } from '../../../src/distributed/temporal/activities.js';
import type { DeliveryReport } from '../../../src/distributed/temporal/protocol.js';
import {
  commitTo,
  revisionsOf,
} from '../../../src/distributed/temporal/record-store.js';
import { startTemporalHarness, type TemporalHarness } from './harness.js';

/**
 * Obligation 5, against Temporal.
 *
 * > Writes to one execution record MUST be serialized. A mechanism MUST
 * > commit at `cas_version` `0` only where no record exists.
 *
 * Temporal gets both from one place: a record is a workflow, a workflow
 * of a given name is admitted once, and updates to one are applied one
 * at a time. So the revision counter is a consistency check here rather
 * than the thing doing the work — and the last test is about what that
 * does *not* buy, which is the part worth saying out loud.
 *
 * Needs the cluster up.
 */

const WIRE = new ArvoEventSerializer({ type: 'arvoevent' });

/** An item this spec has to itself, so another run cannot move its stock. */
const stockFor = (sku: string, held: number) =>
  `INSERT INTO catalogue (sku, category, held) VALUES ('${sku}', 'orders/raced', ${held})
   ON CONFLICT (sku) DO UPDATE SET held = ${held}`;

describe('writes to one record', () => {
  let harness: TemporalHarness;
  let deliver: (event: ArvoEvent) => Promise<DeliveryReport>;
  /** One delivery to whichever handler is named, on its first attempt. */
  let activityFor: (
    contractType: string,
  ) => (event: ArvoEvent) => Promise<DeliveryReport>;

  beforeAll(async () => {
    harness = await startTemporalHarness('arvo-temporal-serialized-spec');
    const activities = createActivities({
      client: harness.client,
      pool: harness.pool,
    });
    const check = activities[inventoryCheckV1.type];
    if (check === undefined) throw new Error('no activity for the handler');

    deliver = async (event) =>
      (await new MockActivityEnvironment({ attempt: 1 }).run(
        check,
        await WIRE.serialize(event),
      )) as DeliveryReport;

    activityFor = (contractType) => {
      const one = activities[contractType];
      if (one === undefined) throw new Error(`no activity for ${contractType}`);
      return async (event) =>
        (await new MockActivityEnvironment({ attempt: 1 }).run(
          one,
          await WIRE.serialize(event),
        )) as DeliveryReport;
    };
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

  it('creates a first revision only where none exists', async () => {
    const executionId = `${Date.now().toString(16)}${'1'.repeat(64)}`.slice(
      0,
      64,
    );
    const first = {
      executionId,
      casVersion: 0,
      lifecycle: 'idle' as const,
    };

    // Two writers, both claiming to be the first. Temporal admits one
    // workflow of this name, so both updates reach the same one and it
    // is the store that refuses the second — not a read followed by a
    // write that happened to be ordered.
    const [one, two] = await Promise.all([
      commitTo(harness.client, {
        executionId,
        revision: { triggeringEventId: 'writer-one', state: first, events: [] },
      }),
      commitTo(harness.client, {
        executionId,
        revision: { triggeringEventId: 'writer-two', state: first, events: [] },
      }),
    ]);

    expect([one.committed, two.committed].filter(Boolean).length).toBe(1);
    expect((await revisionsOf(harness.client, executionId)).length).toBe(1);
  }, 120_000);

  it('refuses a revision that does not follow the one before it', async () => {
    const executionId = `${Date.now().toString(16)}${'2'.repeat(64)}`.slice(
      0,
      64,
    );

    // Far ahead of nothing.
    const ahead = await commitTo(harness.client, {
      executionId,
      revision: {
        triggeringEventId: 'far-ahead',
        state: { executionId, casVersion: 7, lifecycle: 'idle' },
        events: [],
      },
    });
    expect(ahead).toMatchObject({
      committed: false,
      because: 'revision_out_of_sequence',
    });

    // And far ahead of something.
    await commitTo(harness.client, {
      executionId,
      revision: {
        triggeringEventId: 'the-first',
        state: { executionId, casVersion: 0, lifecycle: 'idle' },
        events: [],
      },
    });
    const skipped = await commitTo(harness.client, {
      executionId,
      revision: {
        triggeringEventId: 'skipping-one',
        state: { executionId, casVersion: 2, lifecycle: 'idle' },
        events: [],
      },
    });
    expect(skipped).toMatchObject({
      committed: false,
      because: 'revision_out_of_sequence',
    });

    // Refused by the store: nothing in the activity decided this, and
    // the record is as it was.
    expect((await revisionsOf(harness.client, executionId)).length).toBe(1);
  }, 120_000);

  it('makes the loser converge rather than publish', async () => {
    const executionId = `${Date.now().toString(16)}${'3'.repeat(64)}`.slice(
      0,
      64,
    );

    await commitTo(harness.client, {
      executionId,
      revision: {
        triggeringEventId: 'the-first',
        state: { executionId, casVersion: 0, lifecycle: 'waiting' },
        events: [],
      },
    });

    // Two writers at the next revision, each for a delivery of its own.
    const next = { executionId, casVersion: 1, lifecycle: 'waiting' as const };
    const [one, two] = await Promise.all([
      commitTo(harness.client, {
        executionId,
        revision: { triggeringEventId: 'answer-one', state: next, events: [] },
      }),
      commitTo(harness.client, {
        executionId,
        revision: { triggeringEventId: 'answer-two', state: next, events: [] },
      }),
    ]);

    const winners = [one, two].filter((outcome) => outcome.committed);
    const losers = [one, two].filter((outcome) => !outcome.committed);
    expect(winners.length).toBe(1);
    expect(losers.length).toBe(1);

    const loser = losers[0];
    if (loser === undefined || loser.committed) return;
    expect(loser.because).toBe('revision_taken');
    // Nothing was committed for the loser's own delivery, so it has
    // nothing to publish — which is what tells the activity to make the
    // delivery again against the record as it now stands rather than
    // dropping the event.
    expect(loser.alreadyCommitted).toBeNull();

    expect((await revisionsOf(harness.client, executionId)).length).toBe(2);
  }, 120_000);

  it('makes a losing delivery retry rather than lose its event', async () => {
    /**
     * The real race is between two answers, so it needs an execution
     * that is waiting on more than one. A walk with something below it
     * asks its children and rests; two of their answers then arrive at
     * the same moment.
     */
    const walk = activityFor(categoryWalkV1.type);

    const asked = createArvoEventFactory(categoryWalkV1).createInput({
      source: 'com.test.serialized',
      subject: `serialized-race-${Date.now()}`,
      to: categoryWalkV1.type,
      data: { category: 'orders', remaining: 1 },
    });
    const parent = await deriveArvoExecutionId(asked);

    const opened = await walk(asked);
    expect(opened.lifecycle).toBe('waiting');
    expect(opened.emitted.length).toBeGreaterThan(1);

    // Each child answers at once, being a leaf.
    const answers: ArvoEvent[] = [];
    for (const request of opened.emitted.slice(0, 2)) {
      const answered = await walk(await WIRE.deserialize(request.payload));
      const reply = answered.emitted[0];
      if (reply === undefined) throw new Error('a child answered nothing');
      answers.push(await WIRE.deserialize(reply.payload));
    }
    expect(answers.length).toBe(2);

    // Both at the parent, at the same moment. Each reads the record at
    // the same revision and writes the next.
    const settled = await Promise.allSettled(answers.map((one) => walk(one)));

    const carried = settled.filter((one) => one.status === 'fulfilled');
    const refused = settled.filter((one) => one.status === 'rejected');

    expect(carried.length).toBe(1);
    expect(refused.length).toBe(1);

    const loser = (refused[0] as PromiseRejectedResult).reason;
    expect(loser).toBeInstanceOf(ApplicationFailure);
    // Not dropped and not published: made again against the record as it
    // now stands, because this delivery was never carried out.
    expect((loser as ApplicationFailure).type).toBe('arvo_record_moved_on');
    expect((loser as ApplicationFailure).nonRetryable).toBe(false);

    // one answer recorded, so the other is still owed
    expect((await revisionsOf(harness.client, parent)).length).toBe(2);

    // Made again, both of them, because which one lost is not something
    // a mechanism is told. The winner's repeat is already carried out
    // and hands back what it committed; the loser's converges against
    // the record as it now stands. One more revision, not two.
    for (const answer of answers) {
      await walk(answer).catch(() => undefined);
    }
    expect((await revisionsOf(harness.client, parent)).length).toBe(3);
  }, 300_000);

  it('does not stop both racing executors from running, and says so', async () => {
    /**
     * This is what compare-and-swap does not buy, and the protocol says
     * it does not. Two deliveries of one event both find no record,
     * both enter the executor, and both do what the executor does
     * outside Arvo. One revision is committed; the side effect happened
     * twice.
     */
    const sku = `sku-raced-${Date.now()}`;
    await harness.pool.query(stockFor(sku, 10));

    const asked = aCheck(`serialized-both-ran-${Date.now()}`, sku);
    const executionId = await deriveArvoExecutionId(asked);

    const [one, two] = await Promise.allSettled([
      deliver(asked),
      deliver(asked),
    ]);

    // exactly one record, as obligation 5 requires
    expect((await revisionsOf(harness.client, executionId)).length).toBe(1);
    expect(
      [one, two].filter(
        (settled) =>
          settled.status === 'fulfilled' &&
          settled.value.outcome === 'produced',
      ).length,
    ).toBe(1);

    // and the stock went down twice, because both executors reserved it
    const held = await harness.pool.query<{ held: number }>(
      'SELECT held FROM catalogue WHERE sku = $1',
      [sku],
    );
    expect(held.rows[0]?.held).toBe(8);
  }, 180_000);
});
