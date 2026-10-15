import { ApplicationFailure } from '@temporalio/activity';
import { Client, Connection } from '@temporalio/client';
import { MockActivityEnvironment } from '@temporalio/testing';
import {
  ArvoEventSerializer,
  createArvoEventFactory,
  deriveArvoExecutionId,
} from 'arvo-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inventoryCheckV1 } from '../../../src/distributed/handler/com_inventory_check/contract.js';
import { createActivities } from '../../../src/distributed/temporal/activities.js';
import {
  commitTo,
  revisionsOf,
  stateOf,
} from '../../../src/distributed/temporal/record-store.js';
import { startTemporalHarness, type TemporalHarness } from './harness.js';

/**
 * Obligation 2, against Temporal.
 *
 * > The mechanism MUST supply the state function, and MUST answer it
 * > live.
 *
 * Here it is a query against the execution's own workflow. The thing to
 * establish is not that the query works but that it is a *read*: asked
 * every time, answering with whatever is stored, judging none of it, and
 * incapable of being told anything about the event that caused the
 * delivery.
 *
 * Needs the cluster up.
 */

const WIRE = new ArvoEventSerializer({ type: 'arvoevent' });

/** An item the seed holds some of. */
const KNOWN_SKU = 'sku-wide-0001';

/**
 * An execution nothing opened, named the way a derived one is.
 *
 * Unique per run, because a record is a workflow and a workflow of a
 * given name is admitted once — a fixed name would meet the one an
 * earlier run of this spec left behind.
 */
const anUnopenedExecution = (): string =>
  `${Date.now().toString(16)}${'0'.repeat(64)}`.slice(0, 64);

describe('how the mechanism answers for the record', () => {
  let harness: TemporalHarness;
  let deliver: (payload: string) => Promise<{
    outcome: string;
    executionId: string | null;
    note: string | null;
  }>;

  beforeAll(async () => {
    harness = await startTemporalHarness('arvo-temporal-state-spec');
    const activities = createActivities({
      client: harness.client,
      pool: harness.pool,
    });
    const one = activities[inventoryCheckV1.type];
    if (one === undefined) throw new Error('no activity for the handler');
    const context = new MockActivityEnvironment({ attempt: 1 });
    deliver = (payload: string) =>
      context.run(one, payload) as ReturnType<typeof deliver>;
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

  it('takes one identifier and nothing about the event', async () => {
    // The whole guarantee is the signature: an execution to read, and
    // the cluster to read it from. There is nowhere to put the event,
    // the entry kind, or anything else that would let this decide
    // something the handler decides.
    expect(stateOf).toHaveLength(2);

    const neverOpened = 'f'.repeat(64);
    expect(await stateOf(harness.client, neverOpened)).toBeNull();
  }, 120_000);

  it('answers with whatever is stored, judging none of it', async () => {
    const executionId = anUnopenedExecution();

    // A revision whose state is not a record. The store takes it: what
    // is stored is the handler's to write and the handler's to judge.
    const written = await commitTo(harness.client, {
      executionId,
      revision: {
        triggeringEventId: 'never-delivered',
        state: {
          executionId,
          casVersion: 0,
          lifecycle: 'idle',
          thisWasNeverWrittenByAHandler: true,
        },
        events: [],
      },
    });
    expect(written.committed).toBe(true);

    const read = await stateOf(harness.client, executionId);
    // handed over as it stands, so whether it is a record is the
    // handler's to decide rather than withheld on its behalf
    expect(read).toEqual({
      executionId,
      casVersion: 0,
      lifecycle: 'idle',
      thisWasNeverWrittenByAHandler: true,
    });
  }, 120_000);

  it('leaves the refusal to the handler, having withheld nothing', async () => {
    const event = aCheck(`state-not-a-record-${Date.now()}`);
    const executionId = await deriveArvoExecutionId(event);

    await commitTo(harness.client, {
      executionId,
      revision: {
        triggeringEventId: 'never-delivered',
        state: { executionId, casVersion: 0, lifecycle: 'idle', wrong: true },
        events: [],
      },
    });

    // The read hands it over, so the handler is what finds an opening
    // event for an execution that already exists and refuses it. Nothing
    // was committed for this delivery, so there is nothing to republish
    // and nothing to send.
    const report = await deliver(await WIRE.serialize(event));
    expect(report.outcome).toBe('nothing');
    expect(report.note).toContain('already been executed');

    // and the stored thing is untouched: a refusal writes nothing
    expect((await revisionsOf(harness.client, executionId))).toHaveLength(1);
  }, 120_000);

  it('answers with what is stored now, not what it answered before', async () => {
    // An execution resting at idle, so its record is still open to
    // writes. One that has come to rest is a different case — see the
    // finding below.
    const executionId = anUnopenedExecution();
    const atFirst = {
      executionId,
      casVersion: 0,
      lifecycle: 'idle',
      stage: 'first',
    };

    expect(
      (
        await commitTo(harness.client, {
          executionId,
          revision: {
            triggeringEventId: 'first-write',
            state: atFirst,
            events: [],
          },
        })
      ).committed,
    ).toBe(true);
    expect(await stateOf(harness.client, executionId)).toEqual(atFirst);

    // Moved with nothing the read could have been told about it.
    const moved = {
      executionId,
      casVersion: 1,
      lifecycle: 'waiting',
      stage: 'second',
    };
    expect(
      (
        await commitTo(harness.client, {
          executionId,
          revision: {
            triggeringEventId: 'second-write',
            state: moved,
            events: [],
          },
        })
      ).committed,
    ).toBe(true);

    // Read again, and it is the second: a read answering from something
    // it had kept would still be reporting the first.
    expect(await stateOf(harness.client, executionId)).toEqual(moved);
  }, 120_000);

  it('fails retry-safe where the store cannot be reached', async () => {
    // A real client over a real connection to nothing listening. The
    // read is the same read and the handler is the same handler; only
    // the cluster is gone.
    const nowhere = Connection.lazy({ address: '127.0.0.1:1' });
    const cutOff = createActivities({
      client: new Client({ connection: nowhere }),
      pool: harness.pool,
    })[inventoryCheckV1.type];
    if (cutOff === undefined) throw new Error('no activity for the handler');

    const context = new MockActivityEnvironment({ attempt: 1 });
    const event = aCheck(`state-unreachable-${Date.now()}`);

    const refused = await context
      .run(cutOff, await WIRE.serialize(event))
      .then(() => null)
      .catch((raised: unknown) => raised);

    expect(refused).toBeInstanceOf(ApplicationFailure);
    const failure = refused as ApplicationFailure;
    // the fault the protocol names for a store that would not answer,
    // and it is retry safe: thrown rather than returned, so Temporal
    // makes the next attempt
    expect(failure.type).toBe('state_resolution_failed');
    expect(failure.nonRetryable).toBe(false);

    await nowhere.close();
  }, 120_000);
});
