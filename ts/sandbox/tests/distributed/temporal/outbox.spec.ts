import { MockActivityEnvironment } from '@temporalio/testing';
import {
  ArvoEventSerializer,
  createArvoEventFactory,
  deriveArvoExecutionId,
} from 'arvo-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inventoryCheckV1 } from '../../../src/distributed/handler/com_inventory_check/contract.js';
import { createActivities } from '../../../src/distributed/temporal/activities.js';
import type { Revision } from '../../../src/distributed/temporal/protocol.js';
import {
  commitTo,
  revisionsOf,
  stateOf,
} from '../../../src/distributed/temporal/record-store.js';
import { startTemporalHarness, type TemporalHarness } from './harness.js';

/**
 * Obligation 1, against Temporal.
 *
 * > The emitted events and the next execution record MUST be preserved
 * > together, and the events MUST reach their destinations once the
 * > record is committed.
 *
 * A revision here is `{ state, events }` held by the execution's own
 * workflow and written by one update, so the two are one thing by
 * construction rather than by a transaction. What is published is read
 * back out of it, which is what makes a repeat hand over the bytes that
 * were committed rather than produce something equivalent again.
 *
 * One delivery is driven directly rather than through a run, because
 * what is under test is what a *repeat* delivery hands back — and a run
 * started twice with one event is deduplicated by its workflow id, so a
 * repeat never reaches the handler that way.
 *
 * Only the activity's own context is supplied by Temporal's test
 * environment. The handler is real, the record is a real workflow in the
 * real cluster, and the data is real Postgres. Nothing stands in for
 * anything the obligation is about.
 *
 * Needs the cluster up. Nothing of the mechanism is in a database.
 */

const WIRE = new ArvoEventSerializer({ type: 'arvoevent' });

/** An item the seed holds some of, so a delivery of this finds something. */
const KNOWN_SKU = 'sku-wide-0001';

describe('what is committed and what is published', () => {
  let harness: TemporalHarness;
  /** The activity as a worker runs it, in a context of its own. */
  let deliver: (payload: string) => Promise<unknown>;

  beforeAll(async () => {
    harness = await startTemporalHarness('arvo-temporal-outbox-spec');
    const activities = createActivities({
      client: harness.client,
      pool: harness.pool,
    });
    const one = activities[inventoryCheckV1.type];
    if (one === undefined) throw new Error('no activity for the handler');

    // Attempt 1, which is Arvo's attempt 0 — the same translation a
    // worker makes.
    const context = new MockActivityEnvironment({ attempt: 1 });
    deliver = (payload: string) => context.run(one, payload);
  }, 120_000);

  afterAll(async () => {
    await harness?.stop();
  }, 60_000);

  /** One check, addressed the way an event addresses a handler. */
  const aCheck = (subject: string) =>
    createArvoEventFactory(inventoryCheckV1).createInput({
      source: 'com.test.outbox',
      subject,
      to: inventoryCheckV1.type,
      data: { sku: KNOWN_SKU, wanted: 1 },
    });

  it('writes the record and what it emitted as one revision', async () => {
    const event = aCheck(`outbox-together-${Date.now()}`);
    const executionId = await deriveArvoExecutionId(event);

    await deliver(await WIRE.serialize(event));

    const revisions = await revisionsOf(harness.client, executionId);
    expect(revisions).toHaveLength(1);

    const only = revisions[0] as Revision;
    // the record, and the events, in the same thing
    expect(only.state.executionId).toBe(executionId);
    expect(only.events.length).toBeGreaterThan(0);
    // and it says which delivery produced them, which is what a repeat
    // reads to find what was committed for it
    expect(only.triggeringEventId).toBe(event.id);
  }, 120_000);

  it('publishes nothing where the commit did not succeed', async () => {
    const event = aCheck(`outbox-refused-${Date.now()}`);
    const executionId = await deriveArvoExecutionId(event);

    // A revision written far ahead of nothing: refused, because a first
    // revision may only be the first.
    const refused = await commitTo(harness.client, {
      executionId,
      revision: {
        triggeringEventId: event.id,
        state: { executionId, casVersion: 7, lifecycle: 'waiting' },
        events: [
          {
            eventId: 'never-published',
            eventType: 'evt_inventory_checked',
            addressedTo: 'com_order_fulfil',
            domain: null,
            handled: true,
            payload: 'nothing read this',
          },
        ],
      },
    });

    expect(refused.committed).toBe(false);
    // nothing was written, so there is nothing to publish from
    expect(await revisionsOf(harness.client, executionId)).toEqual([]);
    expect(await stateOf(harness.client, executionId)).toBeNull();
  }, 120_000);

  it('hands a repeat the bytes that were committed, not new ones', async () => {
    const event = aCheck(`outbox-bytes-${Date.now()}`);
    const executionId = await deriveArvoExecutionId(event);
    const payload = await WIRE.serialize(event);

    const first = (await deliver(payload)) as {
      outcome: string;
      emitted: readonly { eventId: string; payload: string }[];
    };
    expect(first.outcome).toBe('produced');

    const committed = (await revisionsOf(harness.client, executionId))[0];
    expect(committed).toBeDefined();
    if (committed === undefined) return;

    // the same event again. The handler will not produce a second
    // answer, so what comes back must be read rather than made.
    const again = (await deliver(payload)) as {
      outcome: string;
      emitted: readonly { eventId: string; payload: string }[];
    };

    expect(again.outcome).toBe('recovered');
    // byte for byte, and the same event ids, so a receiver can tell it
    // is the same event rather than an equivalent one
    expect(again.emitted.map((one) => one.payload)).toEqual(
      committed.events.map((one) => one.payload),
    );
    expect(again.emitted.map((one) => one.eventId)).toEqual(
      first.emitted.map((one) => one.eventId),
    );
  }, 180_000);

  it('does not write a second revision for a delivery already carried out', async () => {
    const event = aCheck(`outbox-no-second-${Date.now()}`);
    const executionId = await deriveArvoExecutionId(event);
    const payload = await WIRE.serialize(event);

    await deliver(payload);
    await deliver(payload);
    await deliver(payload);

    // three deliveries, one revision: the repeats were discarded rather
    // than processed, which is what makes an event's id matter
    expect(await revisionsOf(harness.client, executionId)).toHaveLength(1);
  }, 180_000);

  it('never holds an event that no revision accounts for', async () => {
    const event = aCheck(`outbox-no-orphans-${Date.now()}`);
    const executionId = await deriveArvoExecutionId(event);

    await deliver(await WIRE.serialize(event));

    const revisions = await revisionsOf(harness.client, executionId);
    for (const revision of revisions) {
      // every event is inside a revision, so there is no way to hold one
      // without the record it was committed with
      expect(revision.state).toBeDefined();
      for (const emitted of revision.events) {
        expect(emitted.payload.length).toBeGreaterThan(0);
        expect(emitted.eventId.length).toBeGreaterThan(0);
      }
    }

    // and the revisions advance one at a time from the first
    expect(revisions.map((one) => one.state.casVersion)).toEqual(
      revisions.map((_unused, position) => position),
    );
  }, 120_000);
});
