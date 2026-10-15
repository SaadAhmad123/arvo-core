import { describe, expect, it } from 'vitest';
import { createArvoEventFactory } from '../../../../src/factories/ArvoEventFactory/index.js';
import {
  declareVersions,
  type OrderContext,
  orderV1,
  paymentV1,
} from './fixture.js';
import { checkInvariants } from './invariants.js';
import { type ArvoChaos, createArvoLattice } from './lattice.js';

/**
 * One execution asking five hundred at once, answered in no order.
 *
 * Under the join every version takes by default, the executor is entered
 * once, with every answer present. That is what makes concurrency
 * invisible to business code — and it is exactly the promise that breaks
 * first, because an off-by-one in the collection only shows when answers
 * arrive together, out of order, and more than once.
 */

const WIDE = 100;

/** How many times an orchestrator's own business code actually ran. */
const runs = new Map<object, number>();

/** An order whose executor asks a great many workers at once. */
const fanningOut = (width: number, lattice = orderLattice()) => {
  runs.set(lattice, 0);
  lattice.behave(orderV1.type, async (ctx: OrderContext) => {
    runs.set(lattice, (runs.get(lattice) ?? 0) + 1);
    if (ctx.entry === 'followup') {
      const answers = [...ctx.state.inFlightEventMap.values()].filter(
        (answer) => answer !== null,
      ).length;
      await ctx.setState({ data: { stage: 'answering', answers } });
      return ctx.build({
        type: 'evt_order_fulfilled',
        data: { order_id: String(answers) },
      });
    }

    await ctx.setState({ data: { stage: 'asking', answers: 0 } });
    const asking = [];
    for (let at = 0; at < width; at += 1) {
      asking.push(
        await ctx.build({ type: 'com_payment_charge', data: { amount: at } }),
      );
    }
    return asking;
  });
  return lattice;
};

const orderLattice = (chaos: Partial<ArvoChaos> = {}, seed = 5) =>
  createArvoLattice({ versions: declareVersions(), chaos, seed });

const anOrder = (subject = 'order-1') =>
  createArvoEventFactory(orderV1).createInput({
    source: 'com.web.checkout',
    subject,
    to: orderV1.type,
    data: { items: ['book'] },
  });

/** How many times the orchestrator's own executor was entered. */
const entries = (lattice: ReturnType<typeof orderLattice>) =>
  runs.get(lattice) ?? 0;

/** How many times its record was committed, which is once per answer. */
const commits = (lattice: ReturnType<typeof orderLattice>) =>
  lattice.transcript.committed.filter(({ row }) => row.source === orderV1.type)
    .length;

describe('one execution asking five hundred at once', () => {
  it('opens one execution per worker, and one of its own', async () => {
    const lattice = fanningOut(WIDE);
    await lattice.publish(anOrder()).settle();
    expect(lattice.store.size).toBe(WIDE + 1);
  });

  it('enters the executor once more, with every answer in hand', async () => {
    const lattice = fanningOut(WIDE);
    await lattice.publish(anOrder()).settle();

    // opened once, answered once: two rounds, and no more
    expect(entries(lattice)).toBe(2);
    const answered = lattice.transcript.published.find(
      (event) => event.type === 'evt_order_fulfilled',
    );
    expect(answered?.data.order_id).toBe(String(WIDE));
  });

  it('records each answer as it lands, and waits while any is outstanding', async () => {
    const lattice = fanningOut(3);
    lattice.publish(anOrder());
    await lattice.settle();

    const waited = lattice.transcript.committed
      .filter(({ row }) => row.source === orderV1.type)
      .map(({ row }) => row.lifecycle);

    // asked, then an answer at a time, and only the last one finishes it
    expect(waited).toEqual(['waiting', 'waiting', 'waiting', 'success']);
  });

  it('commits once per answer, so no answer is lost to a crash', async () => {
    const lattice = fanningOut(WIDE);
    await lattice.publish(anOrder()).settle();
    expect(commits(lattice)).toBe(WIDE + 1);
  });

  it('answers its caller exactly once', async () => {
    const lattice = fanningOut(WIDE);
    await lattice.publish(anOrder()).settle();
    expect(
      lattice.transcript.published.filter(
        (event) => event.to === 'com.web.checkout',
      ),
    ).toHaveLength(1);
  });

  it('holds everything that must hold, at that width', async () => {
    const lattice = fanningOut(WIDE);
    await lattice.publish(anOrder()).settle();
    await checkInvariants(lattice);
  });
});

describe('the same fan-out under a transport that repeats and reorders', () => {
  const chaotic = async (width = 100) => {
    const lattice = fanningOut(
      width,
      orderLattice({ duplicate: 2, shuffle: true }, 17),
    );
    await lattice.publish(anOrder()).settle();
    return lattice;
  };

  it('still enters the executor exactly twice', async () => {
    expect(entries(await chaotic())).toBe(2);
  });

  it('still answers its caller exactly once', async () => {
    const lattice = await chaotic();
    expect(
      lattice.transcript.published.filter(
        (event) => event.to === 'com.web.checkout',
      ),
    ).toHaveLength(1);
  });

  it('discards every repeat rather than reporting one', async () => {
    const lattice = await chaotic();
    expect(lattice.transcript.discarded.length).toBeGreaterThan(0);
    expect(lattice.transcript.faults).toEqual([]);
  });

  it('reaches the same end as a run where nothing went wrong', async () => {
    const clean = fanningOut(100, orderLattice({}, 17));
    await clean.publish(anOrder()).settle();
    const messy = await chaotic(100);

    const resting = (lattice: ReturnType<typeof orderLattice>) =>
      [...lattice.store.values()]
        .map((row) => `${row.source}:${row.lifecycle}:${row.casVersion}`)
        .sort();

    expect(resting(messy)).toEqual(resting(clean));
  });

  it('holds everything that must hold', async () => {
    await checkInvariants(await chaotic());
  });
});

describe('answers that arrive at the same moment', () => {
  /** Two answers read the same record before either has written. */
  const racing = async (seed: number) => {
    const lattice = fanningOut(2, orderLattice({ loseRace: 0.5 }, seed));
    await lattice.publish(anOrder()).settle();
    return lattice;
  };

  it('refuses the commit that read a record which had moved', async () => {
    const lattice = await racing(3);
    expect(lattice.transcript.conflicts.length).toBeGreaterThan(0);
  });

  it('runs the delivery that lost again, against the record now there', async () => {
    const lattice = await racing(3);
    const lost = lattice.transcript.conflicts[0];
    const after = lattice.transcript.delivered.filter(
      (given) => given.event.id === lost?.event.id,
    );
    expect(after.length).toBeGreaterThan(1);
  });

  it('still reaches the end every workflow was owed', async () => {
    const lattice = await racing(3);
    expect(
      lattice.transcript.published.filter(
        (event) => event.to === 'com.web.checkout',
      ),
    ).toHaveLength(1);
  });

  it('publishes nothing for the round that lost', async () => {
    const lattice = await racing(3);
    const lost = lattice.transcript.conflicts.length;
    const answered = lattice.transcript.published.filter(
      (event) => event.type === 'evt_order_fulfilled',
    );
    expect(lost).toBeGreaterThan(0);
    expect(answered.length).toBeLessThanOrEqual(1);
  });

  it('leaves the store with one record per execution, whoever won', async () => {
    const lattice = await racing(9);
    expect(lattice.store.size).toBeLessThanOrEqual(3);
    await checkInvariants(lattice);
  });

  it('holds across many different races', async () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      await checkInvariants(await racing(seed));
    }
  });
});

describe('a worker that answers with its own failure', () => {
  it('reaches the orchestrator as an answer like any other', async () => {
    const lattice = fanningOut(2);
    lattice.behave(paymentV1.type, () => {
      throw new Error('the gateway is down');
    });
    await lattice.publish(anOrder()).settle();

    const told = lattice.transcript.published.filter(
      (event) => event.type === paymentV1.error.type,
    );
    expect(told).toHaveLength(2);
    expect(
      lattice.transcript.published.filter(
        (event) => event.type === 'evt_order_fulfilled',
      ),
    ).toHaveLength(1);
  });

  it('rests each failed worker at error, and the order at success', async () => {
    const lattice = fanningOut(2);
    lattice.behave(paymentV1.type, () => {
      throw new Error('the gateway is down');
    });
    await lattice.publish(anOrder()).settle();

    const resting = [...lattice.store.values()].map(
      (row) => `${row.source}:${row.lifecycle}`,
    );
    expect(resting.filter((at) => at.endsWith(':error'))).toHaveLength(2);
    expect(resting).toContain(`${orderV1.type}:success`);
  });

  it('holds everything that must hold', async () => {
    const lattice = fanningOut(2);
    lattice.behave(paymentV1.type, () => {
      throw new Error('the gateway is down');
    });
    await lattice.publish(anOrder()).settle();
    await checkInvariants(lattice);
  });
});
