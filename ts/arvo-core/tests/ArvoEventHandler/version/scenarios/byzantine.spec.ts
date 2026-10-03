import { describe, expect, it } from 'vitest';
import type { ArvoEvent } from '../../../../src/ArvoEvent/index.js';
import type { ArvoFaultKind } from '../../../../src/ArvoEventHandler/fault/types.js';
import { createArvoEventFactory } from '../../../../src/factories/ArvoEventFactory/index.js';
import { cloneArvoEvent } from '../../../../src/factories/cloneArvoEvent.js';
import {
  declareVersions,
  inventoryV1,
  type OrderContext,
  orderV1,
  paymentV1,
  type WorkerContext,
} from './fixture.js';
import {
  everyEventSitsWhereItSaysItDoes,
  everyEventStaysInItsWorkflow,
  everyRecordIsUnderItsOwnIdentity,
  everyRecordReadsBack,
  nothingAwaitsWhatWasNeverSent,
  nothingOutlivesItsEnd,
  revisionsAdvanceOneAtATime,
} from './invariants.js';
import { createArvoLattice } from './lattice.js';

/**
 * Services that answer, and answer wrongly.
 *
 * A lattice is other people's deployments. They are not malicious, they
 * are out of date, half-rolled-back, or written against a reading of the
 * contract nobody checked. What must hold is that an execution waiting on
 * one is never moved by an answer that is not the answer it is owed, and
 * that what it is told says which field was wrong.
 */

const anOrder = (subject = 'order-1') =>
  createArvoEventFactory(orderV1).createInput({
    source: 'com.web.checkout',
    subject,
    to: orderV1.type,
    data: { items: ['book'] },
  });

/** An order asking two services, answering once both reply. */
const asking = (
  lattice = createArvoLattice({
    versions: declareVersions(),
    seed: 37,
    abandons: false,
  }),
) => {
  lattice.behave(orderV1.type, async (ctx: OrderContext) => {
    if (ctx.entry === 'followup') {
      await ctx.setState({ data: { stage: 'answering', answers: 2 } });
      return ctx.build({
        type: 'evt_order_fulfilled',
        data: { order_id: 'o-1' },
      });
    }
    await ctx.setState({ data: { stage: 'asking', answers: 0 } });
    return [
      await ctx.build({
        type: 'com_inventory_reserve',
        data: { items: ['book'] },
      }),
      await ctx.build({ type: 'com_payment_charge', data: { amount: 1 } }),
    ];
  });

  // Both services do their work and say nothing, so the order is still
  // waiting when the answers in this file arrive — which is the only
  // state in which a wrong answer can do any harm.
  for (const quiet of [inventoryV1.type, paymentV1.type]) {
    lattice.behave(quiet, async (ctx: WorkerContext<typeof inventoryV1>) => {
      await ctx.setState({ data: { stage: 'quiet', answers: 0 } });
    });
  }
  return lattice;
};

/** An order that has asked, with what it asked for in hand. */
const asked = async () => {
  const lattice = asking();
  await lattice.publish(anOrder()).settle();

  const requests = lattice.transcript.published.filter(
    (event) => event.initid === null && event.parentid !== null,
  );
  const order = [...lattice.store.entries()].find(
    ([, row]) => row.source === orderV1.type,
  ) as [string, Record<string, unknown>];

  return {
    lattice,
    executionId: order[0],
    toInventory: requests.find(
      (event) => event.type === inventoryV1.type,
    ) as ArvoEvent,
    toPayment: requests.find(
      (event) => event.type === paymentV1.type,
    ) as ArvoEvent,
  };
};

/** What a well-behaved inventory service would answer with. */
const properAnswer = (request: ArvoEvent, executionId: string) =>
  createArvoEventFactory(inventoryV1).createOutput({
    type: 'evt_inventory_reserved',
    source: inventoryV1.type,
    subject: request.subject,
    to: orderV1.type,
    executionid: executionId,
    parentid: request.id,
    initid: request.id,
    depth: request.depth,
    data: { held: 1 },
  });

/** That answer, spoiled in one way, and what the order makes of it. */
const spoiled = async (
  overrides: Record<string, unknown>,
): Promise<{
  kind: ArvoFaultKind | null;
  lattice: Awaited<ReturnType<typeof asked>>['lattice'];
}> => {
  const { lattice, executionId, toInventory } = await asked();
  lattice.inject(
    cloneArvoEvent(properAnswer(toInventory, executionId), overrides),
  );
  await lattice.settle();
  return {
    kind: lattice.transcript.faults.at(-1)?.fault.faultKind ?? null,
    lattice,
  };
};

describe('a service that answers the wrong thing', () => {
  it('answers in a workflow that is not the one it was asked in', async () => {
    const { kind } = await spoiled({ subject: 'another-workflow' });
    expect(kind).toBe('addressing_mismatch');
  });

  it('answers naming an execution that did not ask', async () => {
    const { kind, lattice } = await spoiled({ executionid: 'f'.repeat(64) });

    // It never reaches this execution at all: an answer is routed by the
    // execution it names, and that one has no record. Nothing of this
    // one is touched, and the diagnosis belongs one layer up.
    expect(kind).toBeNull();
    expect(
      lattice.transcript.delivered.some(
        (given) => given.executionId === 'f'.repeat(64),
      ),
    ).toBe(false);
  });

  it('answers a request that was never made', async () => {
    const { kind } = await spoiled({ initid: 'never-asked' });
    expect(kind).toBe('response_unawaited');
  });

  it('answers without saying what it answers', async () => {
    const { kind } = await spoiled({ initid: null as never });
    expect(kind).toBe('response_unawaited');
  });

  it('answers something addressed elsewhere', async () => {
    const { kind, lattice } = await spoiled({ to: 'com.somewhere.else' });

    // Addressed away from this handler, it is routed away from it: no
    // execution of this contract ever sees it.
    expect(kind).toBeNull();
    expect(
      lattice.transcript.delivered.map((given) => given.event.to),
    ).not.toContain('com.somewhere.else');
  });

  it('answers from deeper than it was asked at', async () => {
    const { kind } = await spoiled({ depth: 7 });
    // depth is not addressing: a wrong one is accepted here and caught
    // by the bound, which is what the bound is for
    expect(kind).toBeNull();
  });

  it('names the field that disagrees, where one reaches this execution', async () => {
    const { lattice } = await spoiled({ subject: 'another-workflow' });
    const refused = lattice.transcript.faults.at(-1)?.fault;
    expect(
      refused?.violations.some((broken) => broken.includes('subject')),
    ).toBe(true);
  });

  it('leaves the execution waiting on what it is still owed', async () => {
    const { lattice } = await spoiled({ subject: 'another-workflow' });
    const order = [...lattice.store.values()].find(
      (row) => row.source === orderV1.type,
    );
    expect(order?.lifecycle).toBe('waiting');
  });

  it('publishes nothing on behalf of an execution it did not move', async () => {
    const { lattice } = await spoiled({ initid: 'never-asked' });
    const answered = lattice.transcript.published.filter(
      (event) => event.to === 'com.web.checkout',
    );
    expect(answered).toEqual([]);
  });
});

describe('two services that answer as though they were one', () => {
  it('refuses the second answer carrying an id the first already used', async () => {
    const { lattice, executionId, toInventory, toPayment } = await asked();
    const first = properAnswer(toInventory, executionId);

    // a second service replying with the first one's event id, which
    // ADR-001 requires to be unique across the ecosystem
    const impostor = cloneArvoEvent(first, {
      initid: toPayment.id,
      parentid: toPayment.id,
    });

    lattice.inject(first);
    await lattice.settle();
    lattice.inject(impostor);
    await lattice.settle();

    // the trail already holds that id as received, so the second is a
    // repeat rather than an answer, and the order is still owed one
    expect(lattice.transcript.discarded.length).toBeGreaterThan(0);
    const order = [...lattice.store.values()].find(
      (row) => row.source === orderV1.type,
    );
    expect(order?.lifecycle).toBe('waiting');
  });

  it('leaves the store exactly as a lie found it', async () => {
    const { lattice, executionId, toInventory } = await asked();
    const before = JSON.stringify([...lattice.store.entries()]);

    lattice.inject(
      cloneArvoEvent(properAnswer(toInventory, executionId), {
        subject: 'another-workflow',
      }),
    );
    await lattice.settle();

    expect(JSON.stringify([...lattice.store.entries()])).toBe(before);
  });

  it('holds everything that must hold, once the truth arrives', async () => {
    const { lattice, executionId, toInventory, toPayment } = await asked();
    lattice.inject(properAnswer(toInventory, executionId));
    lattice.inject(
      cloneArvoEvent(properAnswer(toPayment, executionId), {
        parentid: toPayment.id,
        initid: toPayment.id,
      }),
    );
    await lattice.settle();

    // Every property but one: the services here never answered for
    // themselves — a test stood in for them — so what a handler produced
    // is not what answered these requests, and the one property about
    // that is not this scenario's to make.
    everyRecordReadsBack(lattice);
    revisionsAdvanceOneAtATime(lattice);
    everyEventSitsWhereItSaysItDoes(lattice);
    everyEventStaysInItsWorkflow(lattice);
    nothingAwaitsWhatWasNeverSent(lattice);
    nothingOutlivesItsEnd(lattice);
    await everyRecordIsUnderItsOwnIdentity(lattice);

    const order = [...lattice.store.values()].find(
      (row) => row.source === orderV1.type,
    );
    expect(order?.lifecycle).toBe('success');
  });
});

describe('a service from a version this handler never declared', () => {
  it('is refused, the answer naming a contract nothing asked', async () => {
    const { lattice, executionId, toInventory } = await asked();

    // the same service, rolled forward to a version this handler does
    // not declare: the type is unchanged, so only the schema it names
    // says anything is different
    const newer = cloneArvoEvent(properAnswer(toInventory, executionId), {
      dataschema: `${inventoryV1.uri}/2.0.0`,
    });
    lattice.inject(newer);
    await lattice.settle();

    const order = [...lattice.store.values()].find(
      (row) => row.source === orderV1.type,
    );
    expect(order?.lifecycle).toBe('waiting');
  });
});
