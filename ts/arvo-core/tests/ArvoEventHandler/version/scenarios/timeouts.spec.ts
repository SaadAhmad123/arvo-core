import { describe, expect, it } from 'vitest';
import { createArvoEventFactory } from '../../../../src/factories/ArvoEventFactory/index.js';
import {
  declareVersions,
  type OrderContext,
  orderV1,
  paymentV1,
  type WorkerContext,
} from './fixture.js';
import { checkInvariants } from './invariants.js';
import { createArvoLattice } from './lattice.js';

/**
 * A worker that does not come back, and a version that will not wait.
 *
 * The clock an attempt is given is the only thing standing between a
 * stuck executor and a worker pinned forever. What must then hold is that
 * each attempt is its own, that they are counted, that spending them all
 * ends the matter rather than looping, and that the caller hears exactly
 * one thing about it however many attempts were made.
 */

const anOrder = (subject = 'order-1') =>
  createArvoEventFactory(orderV1).createInput({
    source: 'com.web.checkout',
    subject,
    to: orderV1.type,
    data: { items: ['book'] },
  });

/** A lattice whose payment worker never returns. */
const stuck = (overrides: Record<string, unknown> = {}, abandons = true) => {
  const lattice = createArvoLattice({
    versions: declareVersions({
      [paymentV1.type]: { runTimeout: 20, maxRetryAttempts: 3, ...overrides },
    }),
    seed: 31,
    abandons,
  });
  lattice.behave(paymentV1.type, () => new Promise(() => undefined));
  return lattice;
};

/** Every attempt made at one kind of execution. */
const attemptsAt = (lattice: ReturnType<typeof stuck>, contractType: string) =>
  lattice.transcript.delivered
    .filter((given) => given.event.to === contractType)
    .map((given) => given.attempt);

describe('a worker that never comes back', () => {
  it('is not waited on past the time one attempt is given', async () => {
    const lattice = stuck();
    await lattice.publish(anOrder()).settle();

    const refused = lattice.transcript.faults.map(
      ({ fault }) => fault.faultKind,
    );
    expect(new Set(refused)).toEqual(new Set(['run_timeout']));
  });

  it('is tried again, each attempt counted from the one before', async () => {
    const lattice = stuck();
    await lattice.publish(anOrder()).settle();
    expect(attemptsAt(lattice, paymentV1.type)).toEqual([0, 1, 2, 3]);
  });

  it('stops once the attempts the version allows are spent', async () => {
    const lattice = stuck({ maxRetryAttempts: 1 });
    await lattice.publish(anOrder()).settle();
    expect(attemptsAt(lattice, paymentV1.type)).toEqual([0, 1]);
  });

  it('says another attempt is due until the last, and then says none is', async () => {
    const lattice = stuck();
    await lattice.publish(anOrder()).settle();

    const verdicts = lattice.transcript.faults.map(
      ({ fault }) => fault.retry !== null,
    );
    expect(verdicts).toEqual([true, true, true, false]);
  });

  it('keeps the kind unchanged once the attempts are spent', async () => {
    const lattice = stuck();
    await lattice.publish(anOrder()).settle();
    expect(lattice.transcript.faults.at(-1)?.fault.faultKind).toBe(
      'run_timeout',
    );
  });

  it('carries what giving up takes, only on the attempt that gave up', async () => {
    const lattice = stuck();
    await lattice.publish(anOrder()).settle();

    const spent = lattice.transcript.faults.at(-1)?.fault;
    expect(typeof spent?.abandonmentEvent).toBe('string');
    expect(typeof spent?.abandonmentState).toBe('string');
    expect(lattice.transcript.abandoned).toHaveLength(1);
  });

  it('tells the order once, however many attempts were made', async () => {
    const lattice = stuck();
    await lattice.publish(anOrder()).settle();

    const told = lattice.transcript.published.filter(
      (event) => event.type === paymentV1.error.type,
    );
    expect(told).toHaveLength(1);
  });

  it('lets the order go on, one branch having failed', async () => {
    const lattice = stuck();
    await lattice.publish(anOrder()).settle();

    const order = [...lattice.store.values()].find(
      (row) => row.source === orderV1.type,
    );
    expect(order?.lifecycle).toBe('success');
  });

  it('writes nothing for an attempt that was abandoned, until it is', async () => {
    const lattice = stuck({}, false);
    await lattice.publish(anOrder()).settle();

    const payment = [...lattice.store.values()].filter(
      (row) => row.source === paymentV1.type,
    );
    expect(payment).toEqual([]);
  });

  it('holds everything that must hold, with a branch given up on', async () => {
    const lattice = stuck();
    await lattice.publish(anOrder()).settle();
    await checkInvariants(lattice);
  });
});

describe('a version that waits as long as it takes', () => {
  it('waits, where it set no bound on one attempt', async () => {
    const lattice = createArvoLattice({
      versions: declareVersions({
        [paymentV1.type]: { runTimeout: null, executionTimeout: null },
      }),
      seed: 7,
    });
    lattice.behave(
      paymentV1.type,
      async (ctx: WorkerContext<typeof paymentV1>) => {
        await new Promise((settle) => setTimeout(settle, 40));
        await ctx.setState({ data: { stage: 'done', answers: 0 } });
        return ctx.build({
          type: 'evt_payment_charged',
          data: { receipt: 'r-1' },
        });
      },
    );
    await lattice.publish(anOrder()).settle();

    expect(lattice.transcript.faults).toEqual([]);
    await checkInvariants(lattice);
  });
});

describe('an execution that outlives the time the whole of it is given', () => {
  it('is refused on the way in, once its bound has passed', async () => {
    const lattice = createArvoLattice({
      versions: declareVersions({
        [orderV1.type]: { runTimeout: 30, executionTimeout: 40 },
      }),
      seed: 13,
    });

    // The services answer, but not before the order has outlived itself.
    lattice.behave(orderV1.type, async (ctx: OrderContext) => {
      await ctx.setState({ data: { stage: 'asking', answers: 0 } });
      if (ctx.entry === 'followup') {
        return ctx.build({
          type: 'evt_order_fulfilled',
          data: { order_id: 'o-1' },
        });
      }
      return ctx.build({ type: 'com_payment_charge', data: { amount: 1 } });
    });
    lattice.behave(
      paymentV1.type,
      async (ctx: WorkerContext<typeof paymentV1>) => {
        await new Promise((settle) => setTimeout(settle, 60));
        await ctx.setState({ data: { stage: 'done', answers: 0 } });
        return ctx.build({
          type: 'evt_payment_charged',
          data: { receipt: 'r-1' },
        });
      },
    );

    await lattice.publish(anOrder()).settle();

    const late = lattice.transcript.faults.find(
      ({ fault }) => fault.faultKind === 'execution_timeout',
    );
    expect(late).toBeDefined();
    expect(late?.fault.retry).toBeNull();
    expect(late?.fault.message).toContain('executionTimeout');
  });

  it('is not given another attempt, no attempt being able to give time back', async () => {
    const lattice = createArvoLattice({
      versions: declareVersions({
        [orderV1.type]: { runTimeout: 30, executionTimeout: 40 },
      }),
      seed: 13,
    });
    lattice.behave(orderV1.type, async (ctx: OrderContext) => {
      await ctx.setState({ data: { stage: 'asking', answers: 0 } });
      if (ctx.entry === 'followup') {
        return ctx.build({
          type: 'evt_order_fulfilled',
          data: { order_id: 'o-1' },
        });
      }
      return ctx.build({ type: 'com_payment_charge', data: { amount: 1 } });
    });
    lattice.behave(
      paymentV1.type,
      async (ctx: WorkerContext<typeof paymentV1>) => {
        await new Promise((settle) => setTimeout(settle, 60));
        await ctx.setState({ data: { stage: 'done', answers: 0 } });
        return ctx.build({
          type: 'evt_payment_charged',
          data: { receipt: 'r-1' },
        });
      },
    );
    await lattice.publish(anOrder()).settle();

    const atOrder = attemptsAt(lattice, orderV1.type);
    expect(atOrder.filter((attempt) => attempt > 0)).toEqual([]);
  });
});
