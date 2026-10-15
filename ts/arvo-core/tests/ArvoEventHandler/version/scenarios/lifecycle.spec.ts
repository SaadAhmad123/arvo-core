import { trace } from '@opentelemetry/api';
import { describe, expect, it } from 'vitest';
import { ArvoDomain } from '../../../../src/ArvoDomain/index.js';
import type { ArvoEvent } from '../../../../src/ArvoEvent/index.js';
import { ArvoExecutionContextTelemetry } from '../../../../src/ArvoEventHandler/context/telemetry/index.js';
import type { ArvoHandlerFault } from '../../../../src/ArvoEventHandler/fault/index.js';
import { createArvoEventFactory } from '../../../../src/factories/ArvoEventFactory/index.js';
import { cloneArvoEvent } from '../../../../src/factories/cloneArvoEvent.js';
import type { JSONObject } from '../../../../src/types.js';
import {
  declareVersions,
  type OrderContext,
  orderContract,
  orderV1,
  orderV11,
  type RushOrderContext,
  reviewV1,
} from './fixture.js';
import { checkInvariants } from './invariants.js';
import { createArvoLattice } from './lattice.js';

/**
 * An order a customer withdraws, and a deployment that changes under
 * executions already running.
 *
 * Nothing outside an execution can stop it: what the model offers is a
 * signal an execution reads when it next runs, and a lifecycle that says
 * why it ended. And nothing moves an execution between versions: a record
 * belongs to the one that opened it for its whole life, which is what
 * makes an upgrade safe while work is in flight.
 */

/** What an execution records against, which nothing collects here. */
const telemetryFor = () =>
  new ArvoExecutionContextTelemetry({
    span: trace.getTracer('lifecycle').startSpan('execution'),
    meter: null,
    logger: null,
  });

const anOrder = (subject = 'order-1', rush = false) =>
  rush
    ? createArvoEventFactory(orderV11).createInput({
        source: 'com.web.checkout',
        subject,
        to: orderV11.type,
        data: { items: ['book'], rush: true },
      })
    : createArvoEventFactory(orderV1).createInput({
        source: 'com.web.checkout',
        subject,
        to: orderV1.type,
        data: { items: ['book'] },
      });

/** What the application knows about orders a customer withdrew. */
const withdrawn = new Set<string>();

const latticeWith = (abandons = true) => {
  const lattice = createArvoLattice({
    versions: declareVersions(),
    seed: 19,
    abandons,
  });
  return lattice;
};

/**
 * An order that asks a person, and on being answered reads whether the
 * customer has withdrawn before deciding what to do.
 */
const windingDown = (lattice = latticeWith()) => {
  lattice.behave(orderV1.type, async (ctx: OrderContext) => {
    if (ctx.entry === 'init') {
      await ctx.setState({ data: { stage: 'asking', answers: 0 } });
      return ctx.build({
        type: 'com_manual_review',
        data: { order_id: 'o-1' },
        domain: ArvoDomain.FROM_EVENT_CONTRACT,
      });
    }

    // What an application's own signal reaches an executor as: something
    // it reads when it next runs, which is the only moment it can.
    if (withdrawn.has(ctx.state.subject)) {
      await ctx.setState({ data: { stage: 'withdrawn', answers: 1 } });
      ctx.cancel('the customer withdrew the order');
      return ctx.build({
        type: 'evt_order_fulfilled',
        data: { order_id: 'withdrawn' },
      });
    }

    await ctx.setState({ data: { stage: 'answering', answers: 1 } });
    return ctx.build({
      type: 'evt_order_fulfilled',
      data: { order_id: 'o-1' },
    });
  });
  return lattice;
};

/** What a person decides, put back into the lattice. */
const decided = (asked: ArvoEvent) =>
  cloneArvoEvent(
    createArvoEventFactory(reviewV1).createOutput({
      type: 'evt_review_decided',
      source: reviewV1.type,
      subject: asked.subject,
      to: asked.source,
      data: { approved: true },
    }),
    {
      executionid: asked.executionid,
      parentid: asked.id,
      initid: asked.id,
      depth: asked.depth,
    },
  );

const orderRow = (lattice: ReturnType<typeof latticeWith>, at = 0) =>
  [...lattice.store.values()].filter((row) => row.source === orderV1.type)[
    at
  ] as JSONObject;

describe('an order a customer withdraws while it is waiting', () => {
  it('is not stopped by the signal alone, nothing being delivered to it', async () => {
    withdrawn.clear();
    const lattice = windingDown();
    await lattice.publish(anOrder()).settle();
    expect(orderRow(lattice).lifecycle).toBe('waiting');

    withdrawn.add('order-1');
    await lattice.settle();

    // the signal is set, and the execution is waiting on a person: nothing
    // reaches it, so nothing reads the signal, and it stays as it was
    expect(orderRow(lattice).lifecycle).toBe('waiting');
  });

  it('reads the signal on the next delivery, and ends where it said', async () => {
    withdrawn.clear();
    const lattice = windingDown();
    await lattice.publish(anOrder('order-2')).settle();

    withdrawn.add('order-2');
    lattice.fulfil('human_review', (asked) => decided(asked));
    await lattice.settle();

    const row = [...lattice.store.values()].find(
      (held) => held.source === orderV1.type && held.subject === 'order-2',
    );
    expect(row?.lifecycle).toBe('cancelled');
    expect(row?.lifecycleDescription).toBe('the customer withdrew the order');
  });

  it('still answers its caller, cancelling being no way out of that', async () => {
    withdrawn.clear();
    withdrawn.add('order-3');
    const lattice = windingDown();
    await lattice.publish(anOrder('order-3')).settle();
    lattice.fulfil('human_review', (asked) => decided(asked));
    await lattice.settle();

    const told = lattice.transcript.published.filter(
      (event) => event.to === 'com.web.checkout',
    );
    expect(told).toHaveLength(1);
    expect(told[0]?.data.order_id).toBe('withdrawn');
  });

  it('refuses one that ends itself and answers nobody', async () => {
    const lattice = latticeWith(false);
    lattice.behave(orderV1.type, async (ctx: OrderContext) => {
      await ctx.setState({ data: { stage: 'withdrawn', answers: 0 } });
      ctx.cancel('the customer withdrew the order');
    });
    await lattice.publish(anOrder('order-4')).settle();

    const refused = lattice.transcript.faults[0]?.fault;
    expect(refused?.faultKind).toBe('execution_cancelled');
    expect(refused?.message).toContain('the customer withdrew the order');
    expect(lattice.store.size).toBe(0);
  });

  it('refuses a second answer reaching one that already ended', async () => {
    withdrawn.clear();
    withdrawn.add('order-5');
    const lattice = windingDown(latticeWith(false));
    await lattice.publish(anOrder('order-5')).settle();

    const asked = lattice.parked.get('human_review')?.[0] as ArvoEvent;
    lattice.inject(decided(asked));
    await lattice.settle();

    const row = [...lattice.store.values()].find(
      (held) => held.source === orderV1.type,
    );
    expect(row?.lifecycle).toBe('cancelled');

    // somebody decides a second time, on an order already withdrawn
    lattice.inject(cloneArvoEvent(decided(asked), { id: 'a-second-opinion' }));
    await lattice.settle();

    expect(lattice.transcript.faults.at(-1)?.fault.faultKind).toBe(
      'lifecycle_terminal',
    );
    await checkInvariants(lattice);
  });

  it('holds everything that must hold, through a withdrawal', async () => {
    withdrawn.clear();
    withdrawn.add('order-6');
    const lattice = windingDown();
    await lattice.publish(anOrder('order-6')).settle();
    lattice.fulfil('human_review', (asked) => decided(asked));
    await lattice.settle();
    await checkInvariants(lattice);
  });
});

describe('a deployment that changes under work already running', () => {
  /** Orders opened at the first version, with a second now declared. */
  const upgrading = async () => {
    withdrawn.clear();
    const lattice = createArvoLattice({ versions: declareVersions(), seed: 4 });

    lattice.behave(
      orderV1.type,
      async (ctx: OrderContext | RushOrderContext) => {
        if (ctx.entry === 'followup') {
          await ctx.setState({
            data: { stage: 'answering', answers: 1, rush: false },
          });
          return ctx.build({
            type: 'evt_order_fulfilled',
            data: { order_id: ctx.state.version },
          });
        }
        await ctx.setState({
          data: { stage: 'asking', answers: 0, rush: false },
        });
        return ctx.build({ type: 'com_payment_charge', data: { amount: 1 } });
      },
    );

    // one order at each version, both in flight at once
    lattice.publish(anOrder('at-1-0-0')).publish(anOrder('at-1-1-0', true));
    await lattice.settle();
    return lattice;
  };

  it('runs each execution under the version that opened it', async () => {
    const lattice = await upgrading();
    const answered = lattice.transcript.published.filter(
      (event) => event.to === 'com.web.checkout',
    );
    expect(answered.map((event) => event.data.order_id).sort()).toEqual([
      '1.0.0',
      '1.1.0',
    ]);
  });

  it('writes each record under the version it belongs to', async () => {
    const lattice = await upgrading();
    const versions = [...lattice.store.values()]
      .filter((row) => row.source === orderContract.type)
      .map((row) => row.version)
      .sort();
    expect(versions).toEqual(['1.0.0', '1.1.0']);
  });

  it('answers each caller from the version it asked, and once', async () => {
    const lattice = await upgrading();
    const answered = lattice.transcript.published.filter(
      (event) => event.to === 'com.web.checkout',
    );
    expect(answered).toHaveLength(2);
    expect(new Set(answered.map((event) => event.dataschema))).toEqual(
      new Set([orderV1.dataschema, orderV11.dataschema]),
    );
  });

  it('holds everything that must hold, mid-upgrade', async () => {
    await checkInvariants(await upgrading());
  });
});

describe('a record handed to a version it does not belong to', () => {
  /** An order opened at the second version, with its record as stored. */
  const openedAtRush = async () => {
    const lattice = createArvoLattice({ versions: declareVersions(), seed: 8 });
    lattice.behave(orderV1.type, async (ctx: RushOrderContext) => {
      if (ctx.entry === 'followup') {
        await ctx.setState({
          data: { stage: 'answering', answers: 1, rush: true },
        });
        return ctx.build({
          type: 'evt_order_fulfilled',
          data: { order_id: 'o-1' },
        });
      }
      await ctx.setState({
        data: { stage: 'asking', answers: 0, rush: true },
      });
      return ctx.build({ type: 'com_payment_charge', data: { amount: 1 } });
    });
    await lattice.publish(anOrder('rush-1', true)).settle();

    // the record as it stood while waiting, not as it ended: a record
    // that already holds the answer would be refused as a repeat before
    // anything looked at which version it belongs to
    const [executionId] = [...lattice.store.entries()].find(
      ([, held]) => held.version === '1.1.0',
    ) as [string, JSONObject];
    const row = lattice.transcript.committed.find(
      (written) =>
        written.executionId === executionId && written.row.casVersion === 0,
    )?.row as JSONObject;
    const asked = lattice.transcript.published.find(
      (event) => event.type === 'com_payment_charge',
    ) as ArvoEvent;
    const answer = lattice.transcript.published.find(
      (event) => event.initid === asked.id,
    ) as ArvoEvent;
    return { executionId, row, answer, lattice };
  };

  it('is refused rather than run, the two remembering different things', async () => {
    const { executionId, row, answer } = await openedAtRush();
    const versions = declareVersions();

    // What a mechanism that picked the wrong executor would do: hand a
    // record opened at one version to the executor of another.
    await expect(
      versions[orderV1.type]?.['1.0.0']?.execute({
        entry: 'followup',
        event: answer,
        state: row,
        executionId,
        attempt: 0,
        dependencies: {},
        hooks: {},
        telemetry: telemetryFor(),
      } as never),
    ).rejects.toMatchObject({ faultKind: 'version_not_declared' });
  });

  it('says which version it belongs to and which it was handed to', async () => {
    const { executionId, row, answer } = await openedAtRush();
    const versions = declareVersions();

    try {
      await versions[orderV1.type]?.['1.0.0']?.execute({
        entry: 'followup',
        event: answer,
        state: row,
        executionId,
        attempt: 0,
        dependencies: {},
        hooks: {},
        telemetry: telemetryFor(),
      } as never);
    } catch (raised) {
      const refused = raised as ArvoHandlerFault;
      expect(refused.message).toContain('com_order_fulfil@1.1.0');
      expect(refused.message).toContain('com_order_fulfil@1.0.0');
      expect(refused.retry).toBeNull();
      return;
    }
    throw new Error('expected it to be refused');
  });

  it('emits nothing and writes nothing for the one it refused', async () => {
    const { executionId, row, answer } = await openedAtRush();
    const versions = declareVersions();

    await expect(
      versions[orderV1.type]?.['1.0.0']?.execute({
        entry: 'followup',
        event: answer,
        state: row,
        executionId,
        attempt: 0,
        dependencies: {},
        hooks: {},
        telemetry: telemetryFor(),
      } as never),
    ).rejects.toBeDefined();

    // the record a mechanism would commit on giving up rests at failure,
    // and nothing of this round was published
    const refused = await versions[orderV1.type]?.['1.0.0']
      ?.execute({
        entry: 'followup',
        event: answer,
        state: row,
        executionId,
        attempt: 0,
        dependencies: {},
        hooks: {},
        telemetry: telemetryFor(),
      } as never)
      .catch((raised: ArvoHandlerFault) => raised);
    const given = JSON.parse(
      (refused as ArvoHandlerFault).abandonmentState as string,
    );
    expect(given.lifecycle).toBe('failure');
    expect(given.version).toBe('1.1.0');
  });
});
