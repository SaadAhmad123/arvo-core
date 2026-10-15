import { describe, expect, it } from 'vitest';
import { ArvoDomain } from '../../../../src/ArvoDomain/index.js';
import type { ArvoEvent } from '../../../../src/ArvoEvent/index.js';
import { createArvoEventFactory } from '../../../../src/factories/ArvoEventFactory/index.js';
import { cloneArvoEvent } from '../../../../src/factories/cloneArvoEvent.js';
import {
  declareVersions,
  type OrderContext,
  orderV1,
  paymentV1,
  reviewV1,
  type WorkerContext,
} from './fixture.js';
import { checkInvariants } from './invariants.js';
import { createArvoLattice } from './lattice.js';

/**
 * A process that dies part way, an event that never arrives, and what
 * anybody can do about a workflow that has stopped.
 *
 * The handler is correct and the world is not. A machine is lost between
 * reading a record and committing one; a broker drops a request nobody
 * notices; a person is asked for a decision and leaves. Each leaves an
 * execution alive and waiting for something that is not coming, and the
 * handler cannot see any of it: it runs only when something is delivered,
 * and nothing being delivered is exactly the case.
 *
 * What it can do is be resumable from what was stored — by anything,
 * at any later time, with no live dependency surviving in between.
 */

const anOrder = (subject = 'order-1') =>
  createArvoEventFactory(orderV1).createInput({
    source: 'com.web.checkout',
    subject,
    to: orderV1.type,
    data: { items: ['book'] },
  });

/** How many times each worker's business code actually ran. */
const ran = new Map<string, number>();

/** An order asking one service, answering when it replies. */
const asking = (chaos = {}, seed = 53) => {
  const lattice = createArvoLattice({
    versions: declareVersions(),
    chaos,
    seed,
  });
  lattice.behave(orderV1.type, async (ctx: OrderContext) => {
    if (ctx.entry === 'followup') {
      await ctx.setState({ data: { stage: 'answering', answers: 1 } });
      return ctx.build({
        type: 'evt_order_fulfilled',
        data: { order_id: 'o-1' },
      });
    }
    await ctx.setState({ data: { stage: 'asking', answers: 0 } });
    return ctx.build({ type: 'com_payment_charge', data: { amount: 1 } });
  });
  lattice.behave(
    paymentV1.type,
    async (ctx: WorkerContext<typeof paymentV1>) => {
      // what an executor does outside Arvo, which no commit can undo
      const key = ctx.state.executionId;
      ran.set(key, (ran.get(key) ?? 0) + 1);
      await ctx.setState({ data: { stage: 'charged', answers: 0 } });
      return ctx.build({
        type: 'evt_payment_charged',
        data: { receipt: 'r-1' },
      });
    },
  );
  return lattice;
};

const answered = (lattice: ReturnType<typeof asking>) =>
  lattice.transcript.published.filter(
    (event) => event.to === 'com.web.checkout',
  );

const orderRow = (lattice: ReturnType<typeof asking>) =>
  [...lattice.store.values()].find((row) => row.source === orderV1.type);

describe('a process that dies part way through an execution', () => {
  it('leaves nothing behind: no record, no event, no trace of it', async () => {
    const lattice = asking({ crashMidExecution: 1 });
    // one delivery, and no further, since every attempt dies the same way
    await lattice.publish(anOrder()).step();

    expect(lattice.transcript.died).toHaveLength(1);
    expect(lattice.store.size).toBe(0);
    expect(lattice.transcript.committed).toEqual([]);
    expect(lattice.transcript.fromExecutions.size).toBe(0);
  });

  it('is run again from the record that is there, and finishes', async () => {
    ran.clear();
    const lattice = asking({ crashMidExecution: 0.4 });
    await lattice.publish(anOrder()).settle();

    expect(lattice.transcript.died.length).toBeGreaterThan(0);
    expect(answered(lattice)).toHaveLength(1);
    expect(orderRow(lattice)?.lifecycle).toBe('success');
    await checkInvariants(lattice);
  });

  it('reaches the same end as a run where nothing died', async () => {
    const died = asking({ crashMidExecution: 0.4 });
    await died.publish(anOrder()).settle();
    const clean = asking();
    await clean.publish(anOrder()).settle();

    const resting = (lattice: ReturnType<typeof asking>) =>
      [...lattice.store.values()]
        .map((row) => `${row.source}:${row.lifecycle}:${row.casVersion}`)
        .sort();

    expect(resting(died)).toEqual(resting(clean));
  });

  it('does the work outside Arvo again, which is the executor to make safe', async () => {
    ran.clear();
    const lattice = asking();
    await lattice.publish(anOrder()).settle();

    const request = lattice.transcript.published.find(
      (event) => event.type === paymentV1.type,
    ) as ArvoEvent;

    // the same request, run again on a machine that knows nothing of the
    // first: the record refuses to be opened twice, so the protocol
    // commits nothing — but what the executor already did elsewhere is
    // done, and was done again
    const charged = [...ran.values()].reduce((all, one) => all + one, 0);
    expect(charged).toBe(1);
    expect(ran.size).toBe(1);

    const elsewhere = asking();
    ran.clear();
    await elsewhere.publish(request).settle();

    // keyed on the execution, which is derived and therefore the same
    // on both machines: an executor that keys its own writes on it has
    // something stable to be idempotent against
    expect([...ran.keys()]).toEqual([
      [...lattice.store.entries()].find(
        ([, row]) => row.source === paymentV1.type,
      )?.[0],
    ]);
  });

  it('answers its caller exactly once however many times it died', async () => {
    const lattice = asking({ crashMidExecution: 0.6 }, 29);
    await lattice.publish(anOrder()).settle();
    expect(answered(lattice)).toHaveLength(1);
    await checkInvariants(lattice);
  });
});

describe('a request that never arrives', () => {
  /** The order asked, and the broker lost what it asked for. */
  const lost = async () => {
    const lattice = asking().lose(paymentV1.type);
    await lattice.publish(anOrder()).settle();

    const request = lattice.transcript.published.find(
      (event) => event.type === paymentV1.type,
    ) as ArvoEvent;
    return { lattice, request };
  };

  it('leaves the asker waiting, with nothing anywhere to report', async () => {
    const { lattice } = await lost();

    expect(orderRow(lattice)?.lifecycle).toBe('waiting');
    expect(lattice.store.size).toBe(1);
    expect(lattice.transcript.faults).toEqual([]);
    expect(lattice.transcript.discarded).toEqual([]);
  });

  it('is resumed by sending the very same request again', async () => {
    ran.clear();
    const { lattice, request } = await lost();

    // the queue comes back, and somebody sends what was lost. Nothing is
    // rebuilt and nothing is invented: the same event opens exactly the
    // execution it was always going to open, because the identity is
    // derived from the event rather than minted.
    lattice.deliverAgain(paymentV1.type).publish(request);
    await lattice.settle();

    expect(lattice.store.size).toBe(2);
    expect(answered(lattice)).toHaveLength(1);
    await checkInvariants(lattice);
  });

  it('opens one execution for it, not a second one beside the first', async () => {
    const { lattice, request } = await lost();
    lattice.deliverAgain(paymentV1.type).publish(request);
    await lattice.settle();
    lattice.publish(request);
    await lattice.settle();

    // the second is refused before any work is done
    expect(lattice.store.size).toBe(2);
    expect(answered(lattice)).toHaveLength(1);
  });
});

describe('an answer that never arrives', () => {
  it('is resumed by publishing what was committed, not by asking again', async () => {
    const lattice = asking({ crashBeforePublish: 1 });
    await lattice.publish(anOrder()).settle();

    // the request was committed and never left
    expect(lattice.holding).toBe(1);
    expect(orderRow(lattice)?.lifecycle).toBe('waiting');

    while (lattice.holding > 0) await lattice.recover().settle();
    expect(answered(lattice)).toHaveLength(1);
    await checkInvariants(lattice);
  });

  it('is not resumed by asking again, the work already having been done', async () => {
    const lattice = asking();
    await lattice.publish(anOrder()).settle();

    const request = lattice.transcript.published.find(
      (event) => event.type === paymentV1.type,
    ) as ArvoEvent;
    const before = JSON.stringify([...lattice.store.entries()]);

    // sending the same request again reaches an execution that already
    // ran: it is refused rather than charged twice
    ran.clear();
    lattice.publish(request);
    await lattice.settle();

    expect(ran.size).toBe(0);
    expect(JSON.stringify([...lattice.store.entries()])).toBe(before);
  });
});

describe('a workflow nobody is coming back for', () => {
  const waitingOnAPerson = async () => {
    const lattice = createArvoLattice({
      versions: declareVersions({
        [orderV1.type]: { executionTimeout: null },
      }),
      seed: 67,
    });
    lattice.behave(orderV1.type, async (ctx: OrderContext) => {
      if (ctx.entry === 'followup') {
        await ctx.setState({ data: { stage: 'answering', answers: 1 } });
        return ctx.build({
          type: 'evt_order_fulfilled',
          data: { order_id: 'o-1' },
        });
      }
      await ctx.setState({ data: { stage: 'asking', answers: 0 } });
      return ctx.build({
        type: 'com_manual_review',
        data: { order_id: 'o-1' },
        domain: ArvoDomain.FROM_EVENT_CONTRACT,
      });
    });
    await lattice.publish(anOrder()).settle();
    return lattice;
  };

  it('stays exactly where it stopped, for as long as it takes', async () => {
    const lattice = await waitingOnAPerson();
    const stopped = JSON.stringify([...lattice.store.entries()]);

    // nothing happens, repeatedly
    for (let at = 0; at < 5; at += 1) await lattice.settle();

    expect(JSON.stringify([...lattice.store.entries()])).toBe(stopped);
    expect(lattice.transcript.faults).toEqual([]);
  });

  it('is resumed by anything that can address the request it waits on', async () => {
    const lattice = await waitingOnAPerson();
    const asked = lattice.parked.get('human_review')?.[0] as ArvoEvent;

    // an operator, a week later, with nothing of the original process
    // left alive: the record and the request's id are the whole of what
    // resuming it takes
    const byHand = cloneArvoEvent(
      createArvoEventFactory(reviewV1).createOutput({
        type: 'evt_review_decided',
        source: 'com.ops.console',
        subject: asked.subject,
        to: orderV1.type,
        data: { approved: true },
      }),
      {
        executionid: asked.executionid,
        parentid: asked.id,
        initid: asked.id,
        depth: asked.depth,
      },
    );

    lattice.inject(byHand);
    await lattice.settle();

    expect(
      lattice.transcript.published.filter(
        (event) => event.to === 'com.web.checkout',
      ),
    ).toHaveLength(1);
    await checkInvariants(lattice);
  });

  it('is resumed from the stored record alone, nothing of the first run surviving', async () => {
    const first = await waitingOnAPerson();
    const asked = first.parked.get('human_review')?.[0] as ArvoEvent;

    // a different process entirely, which has only the store
    const second = createArvoLattice({
      versions: declareVersions({
        [orderV1.type]: { executionTimeout: null },
      }),
      seed: 68,
    });
    second.behave(orderV1.type, async (ctx: OrderContext) => {
      await ctx.setState({ data: { stage: 'answering', answers: 1 } });
      return ctx.build({
        type: 'evt_order_fulfilled',
        data: { order_id: 'resumed elsewhere' },
      });
    });
    for (const [executionId, row] of first.store) {
      second.store.set(executionId, row);
    }

    second.inject(
      cloneArvoEvent(
        createArvoEventFactory(reviewV1).createOutput({
          type: 'evt_review_decided',
          source: reviewV1.type,
          subject: asked.subject,
          to: orderV1.type,
          data: { approved: true },
        }),
        {
          executionid: asked.executionid,
          parentid: asked.id,
          initid: asked.id,
          depth: asked.depth,
        },
      ),
    );
    await second.settle();

    const told = second.transcript.published.filter(
      (event) => event.to === 'com.web.checkout',
    );
    expect(told).toHaveLength(1);
    expect(told[0]?.data.order_id).toBe('resumed elsewhere');
  });

  it('is refused rather than resumed where its version set a bound and it passed', async () => {
    const lattice = createArvoLattice({
      versions: declareVersions({
        [orderV1.type]: { runTimeout: 20, executionTimeout: 40 },
      }),
      seed: 69,
    });
    lattice.behave(orderV1.type, async (ctx: OrderContext) => {
      if (ctx.entry === 'followup') {
        await ctx.setState({ data: { stage: 'answering', answers: 1 } });
        return ctx.build({
          type: 'evt_order_fulfilled',
          data: { order_id: 'o-1' },
        });
      }
      await ctx.setState({ data: { stage: 'asking', answers: 0 } });
      return ctx.build({
        type: 'com_manual_review',
        data: { order_id: 'o-1' },
        domain: ArvoDomain.FROM_EVENT_CONTRACT,
      });
    });
    await lattice.publish(anOrder()).settle();
    const asked = lattice.parked.get('human_review')?.[0] as ArvoEvent;

    await new Promise((settle) => setTimeout(settle, 60));
    lattice.inject(
      cloneArvoEvent(
        createArvoEventFactory(reviewV1).createOutput({
          type: 'evt_review_decided',
          source: reviewV1.type,
          subject: asked.subject,
          to: orderV1.type,
          data: { approved: true },
        }),
        {
          executionid: asked.executionid,
          parentid: asked.id,
          initid: asked.id,
          depth: asked.depth,
        },
      ),
    );
    await lattice.settle();

    // the bound is read when something is finally delivered, which is
    // the only moment a handler can read anything
    expect(lattice.transcript.faults.at(-1)?.fault.faultKind).toBe(
      'execution_timeout',
    );
  });
});
