import { describe, expect, it } from 'vitest';
import type { ArvoEvent } from '../../../../src/ArvoEvent/index.js';
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
 * One event, two handlers, at the same moment.
 *
 * Two consumers on one queue is the ordinary shape of a deployment, and
 * it is the one shape the duplicate check cannot help with: both read the
 * record before either writes one, so neither can see the other in the
 * trail, and both run their executor through to the end.
 *
 * What decides it is the commit. One lands, the other is refused for
 * having read a record that has since moved, and the delivery that lost
 * runs again — against the record that is now there, where the event it
 * carries is finally recognisable as one already processed.
 *
 * What is not decided by it is anything the losing executor did outside
 * Arvo. That happened, twice, and no commit can take it back.
 */

/** How many times each execution's business code ran, and where. */
const ran: string[] = [];

/**
 * Every property but the one about who answered.
 *
 * The services here say nothing of their own and a test stands in for
 * them, so what answered a request was not a handler, and the property
 * about that is not this file's to make.
 */
const holdsExceptWhoAnswered = async (
  lattice: ReturnType<typeof createArvoLattice>,
) => {
  everyRecordReadsBack(lattice);
  revisionsAdvanceOneAtATime(lattice);
  everyEventSitsWhereItSaysItDoes(lattice);
  everyEventStaysInItsWorkflow(lattice);
  nothingAwaitsWhatWasNeverSent(lattice);
  nothingOutlivesItsEnd(lattice);
  await everyRecordIsUnderItsOwnIdentity(lattice);
};

const anOrder = (subject = 'order-1') =>
  createArvoEventFactory(orderV1).createInput({
    source: 'com.web.checkout',
    subject,
    to: orderV1.type,
    data: { items: ['book'] },
  });

/**
 * An order asking one service, and answering its caller the moment that
 * service replies — so the answer in this file is the one that completes
 * the collection, and every delivery of it enters the executor.
 */
const asking = (seed = 83) => {
  const lattice = createArvoLattice({ versions: declareVersions(), seed });
  lattice.behave(orderV1.type, async (ctx: OrderContext) => {
    ran.push(`order:${ctx.entry}`);
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
    return ctx.build({
      type: 'com_inventory_reserve',
      data: { items: ['book'] },
    });
  });

  // the services say nothing of their own, so the answers in this file
  // are the only ones the order ever sees
  for (const quiet of [inventoryV1.type, paymentV1.type]) {
    lattice.behave(quiet, async (ctx: WorkerContext<typeof inventoryV1>) => {
      await ctx.setState({ data: { stage: 'quiet', answers: 0 } });
    });
  }
  return lattice;
};

/** An order that has asked, with what it asked for in hand. */
const asked = async (seed = 83) => {
  ran.length = 0;
  const lattice = asking(seed);
  await lattice.publish(anOrder()).settle();

  const [executionId, row] = [...lattice.store.entries()].find(
    ([, held]) => held.source === orderV1.type,
  ) as [string, Record<string, unknown>];

  return {
    lattice,
    executionId,
    revision: Number(row.casVersion),
    toInventory: lattice.transcript.published.find(
      (event) => event.type === inventoryV1.type,
    ) as ArvoEvent,
  };
};

/** A service's answer to one of those requests. */
const answerTo = (
  request: ArvoEvent,
  executionId: string,
  overrides: Record<string, unknown> = {},
) =>
  cloneArvoEvent(
    createArvoEventFactory(inventoryV1).createOutput({
      type: 'evt_inventory_reserved',
      source: inventoryV1.type,
      subject: request.subject,
      to: orderV1.type,
      data: { held: 1 },
    }),
    {
      executionid: executionId,
      parentid: request.id,
      initid: request.id,
      depth: request.depth,
      ...overrides,
    },
  );

const orderRow = (lattice: ReturnType<typeof createArvoLattice>) =>
  [...lattice.store.values()].find(
    (row) => row.source === orderV1.type,
  ) as Record<string, unknown[]> & { lifecycle: string; casVersion: number };

describe('one answer, two handlers, at the same moment', () => {
  const racing = async (seed = 83) => {
    const built = await asked(seed);
    const answer = answerTo(built.toInventory, built.executionId);

    ran.length = 0;
    await built.lattice.deliverTogether(answer);
    return { ...built, answer };
  };

  it('runs both, neither being able to see the other', async () => {
    const { lattice } = await racing();

    // the duplicate check cannot save this: at the moment each read the
    // record, the other had written nothing
    expect(ran).toEqual(['order:followup', 'order:followup']);
    expect(lattice.transcript.discarded).toEqual([]);
  });

  it('commits one of them, and refuses the other', async () => {
    const { lattice } = await racing();
    const committed = lattice.transcript.committed.filter(
      ({ row }) => row.source === orderV1.type,
    );

    expect(committed).toHaveLength(2); // the opening round, and one of these
    expect(lattice.transcript.conflicts).toHaveLength(1);
  });

  it('advances the record exactly once, not once per handler', async () => {
    const { lattice, revision } = await racing();
    expect(Number(orderRow(lattice).casVersion)).toBe(revision + 1);
  });

  it('records the answer once, not twice', async () => {
    const { lattice, answer } = await racing();
    const held = (orderRow(lattice).inFlightEventMap as [string, unknown][])
      .filter(([, given]) => given !== null)
      .map(([asking]) => asking);

    expect(held).toEqual([answer.initid]);
    expect(
      (orderRow(lattice).eventIds as { id: string }[]).filter(
        (logged) => logged.id === answer.id,
      ),
    ).toHaveLength(1);
  });

  it('publishes what one of them produced, and nothing of the other', async () => {
    const { lattice, answer } = await racing();

    // both built a completion for the same caller. One left; the other
    // exists nowhere outside the process that built it.
    const caused = lattice.transcript.published.filter(
      (event) => event.parentid === answer.id,
    );
    expect(caused).toHaveLength(1);
    expect(caused[0]?.to).toBe('com.web.checkout');
  });

  it('answers the caller exactly once, which is the whole point', async () => {
    const { lattice } = await racing();
    await lattice.settle();

    expect(
      lattice.transcript.published.filter(
        (event) => event.to === 'com.web.checkout',
      ),
    ).toHaveLength(1);
  });

  it('runs the one that lost again, and it is a repeat by then', async () => {
    const { lattice } = await racing();

    // the delivery that lost is redelivered, and the record it now
    // reads holds the very event it carries
    await lattice.settle();
    expect(lattice.transcript.discarded).toHaveLength(1);
    expect(lattice.transcript.faults).toEqual([]);
  });

  it('did the work outside Arvo twice, which no commit can take back', async () => {
    const { lattice } = await racing();
    await lattice.settle();

    // two executors ran to the end; one of them is remembered nowhere
    expect(ran.filter((one) => one === 'order:followup')).toHaveLength(2);
    expect(
      lattice.transcript.committed.filter(
        ({ row }) => row.source === orderV1.type,
      ),
    ).toHaveLength(2);
  });

  it('holds everything that must hold, once it settles', async () => {
    const { lattice } = await racing();
    await lattice.settle();

    expect(orderRow(lattice).lifecycle).toBe('success');
    await holdsExceptWhoAnswered(lattice);
  });

  it('comes to the same end whichever of them happened to win', async () => {
    const ends = [];
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const { lattice } = await racing(seed);
      await lattice.settle();
      ends.push(
        `${orderRow(lattice).lifecycle}:${orderRow(lattice).casVersion}`,
      );
    }
    expect(new Set(ends).size).toBe(1);
  });
});

describe('one answer, five handlers, at the same moment', () => {
  it('commits one of the five, and the four behind it are repeats', async () => {
    const built = await asked();
    const answer = answerTo(built.toInventory, built.executionId);

    ran.length = 0;
    for (let at = 0; at < 5; at += 1) {
      await built.lattice.deliverTogether(answer);
    }
    await built.lattice.settle();

    // ten executors ran; one write landed, and every later delivery
    // recognised the event as one already handled
    expect(Number(orderRow(built.lattice).casVersion)).toBe(built.revision + 1);
    expect(built.lattice.transcript.discarded.length).toBeGreaterThan(0);
    expect(built.lattice.transcript.faults).toEqual([]);
  });
});

describe('two different answers at the same moment', () => {
  it('loses neither, the one that was refused collecting its own on the way back', async () => {
    ran.length = 0;
    const lattice = createArvoLattice({
      versions: declareVersions(),
      seed: 91,
    });
    lattice.behave(orderV1.type, async (ctx: OrderContext) => {
      if (ctx.entry === 'followup') {
        const answers = [...ctx.state.inFlightEventMap.values()].filter(
          (answer) => answer !== null,
        ).length;
        await ctx.setState({ data: { stage: 'answering', answers } });
        if (answers < 2) return;
        return ctx.build({
          type: 'evt_order_fulfilled',
          data: { order_id: String(answers) },
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
    for (const quiet of [inventoryV1.type, paymentV1.type]) {
      lattice.behave(quiet, async (ctx: WorkerContext<typeof inventoryV1>) => {
        await ctx.setState({ data: { stage: 'quiet', answers: 0 } });
      });
    }
    await lattice.publish(anOrder()).settle();

    const requests = lattice.transcript.published.filter(
      (event) => event.initid === null && event.parentid !== null,
    );
    const [executionId] = [...lattice.store.entries()].find(
      ([, held]) => held.source === orderV1.type,
    ) as [string, Record<string, unknown>];

    // both read the record at the same revision, so each believes it is
    // the first of the two answers
    for (const request of requests) {
      lattice.publish(
        answerTo(request, executionId, {
          parentid: request.id,
          initid: request.id,
        }),
      );
    }
    await lattice.settle();

    const held = (
      orderRow(lattice).inFlightEventMap as [string, unknown][]
    ).filter(([, given]) => given !== null);
    expect(held).toHaveLength(2);
    expect(orderRow(lattice).lifecycle).toBe('success');
    await holdsExceptWhoAnswered(lattice);
  });
});

describe('one opening event, two handlers, at the same moment', () => {
  it('opens one execution, the second being refused by the store', async () => {
    ran.length = 0;
    const lattice = asking();
    const opening = anOrder('order-raced');

    await lattice.deliverTogether(opening);

    // both derived the same execution from the same event, and both
    // tried to create it: a store takes the first and refuses the rest
    expect(ran.filter((one) => one === 'order:init')).toHaveLength(2);
    expect(lattice.store.size).toBe(1);
    expect(lattice.transcript.conflicts).toHaveLength(1);
  });

  it('asks its service once, not once per handler', async () => {
    const lattice = asking();
    await lattice.deliverTogether(anOrder('order-raced'));
    await lattice.settle();

    const asked = lattice.transcript.published.filter(
      (event) => event.initid === null && event.parentid !== null,
    );
    expect(asked.map((event) => event.type)).toEqual(['com_inventory_reserve']);
  });

  it('refuses the loser on its next delivery, a record now existing', async () => {
    const lattice = asking();
    const opening = anOrder('order-raced');
    await lattice.deliverTogether(opening);
    await lattice.settle();

    // nothing of the loser survives: one order, one service it asked
    expect(lattice.store.size).toBe(2);
    expect(lattice.transcript.faults).toEqual([]);
  });
});

describe('one answer to an execution already finished, twice at once', () => {
  it('refuses both without writing anything over what it ended as', async () => {
    const built = await asked();

    // bring it to an end first
    built.lattice.inject(answerTo(built.toInventory, built.executionId));
    await built.lattice.settle();
    expect(orderRow(built.lattice).lifecycle).toBe('success');

    const ended = JSON.stringify(orderRow(built.lattice));
    const late = answerTo(built.toInventory, built.executionId, {
      id: 'a-very-late-answer',
    });
    await built.lattice.deliverTogether(late);

    expect(JSON.stringify(orderRow(built.lattice))).toBe(ended);
    expect(
      built.lattice.transcript.faults
        .map(({ fault }) => fault.faultKind)
        .filter((kind) => kind === 'lifecycle_terminal'),
    ).toHaveLength(2);
  });
});
