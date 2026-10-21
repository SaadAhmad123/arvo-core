import { type Span, trace } from '@opentelemetry/api';
import { describe, expect, it } from 'vitest';
import { ArvoExecutionContextTelemetry } from '../../../../src/ArvoEventHandler/context/telemetry/index.js';
import { deriveArvoExecutionId } from '../../../../src/ArvoEventHandler/helpers/execution-id.js';
import type { ArvoEventHandlerExecuteResponse } from '../../../../src/ArvoEventHandler/types/execute.js';
import { createArvoEventFactory } from '../../../../src/factories/ArvoEventFactory/index.js';
import { heldDependencies } from '../../dependency.js';
import {
  declareVersions,
  type OrderContext,
  orderV1,
  walkV1,
} from './fixture.js';
import { checkInvariants } from './invariants.js';
import { createArvoLattice } from './lattice.js';

/**
 * More, deeper, and for longer than anything will reasonably ask.
 *
 * None of this is a benchmark. What it watches for is the shape of the
 * cost: a collection handled in a way that grows with the square of its
 * width, a trail that accumulates what should be rebuilt, or a version
 * holding on to something between executions. Each of those is invisible
 * at three and ruinous at five thousand.
 */

const executionTelemetry = () =>
  new ArvoExecutionContextTelemetry({
    span: trace.getTracer('scale').startSpan('execution'),
    meter: null,
    logger: null,
  });

const anOrder = (subject = 'order-1') =>
  createArvoEventFactory(orderV1).createInput({
    source: 'com.web.checkout',
    subject,
    to: orderV1.type,
    data: { items: ['book'] },
  });

const aWalk = (remaining: number, subject = 'walk-1') =>
  createArvoEventFactory(walkV1).createInput({
    source: 'com.web.start',
    subject,
    to: walkV1.type,
    data: { node: 'root', remaining },
  });

/** An order that asks a great many at once, then answers. */
const fanOutLattice = (width: number, seed = 101) => {
  const lattice = createArvoLattice({ versions: declareVersions(), seed });
  lattice.behave(orderV1.type, async (ctx: OrderContext) => {
    if (ctx.entry === 'followup') {
      await ctx.setState({ data: { stage: 'answering', answers: width } });
      return ctx.build({
        type: 'evt_order_fulfilled',
        data: { order_id: String(width) },
      });
    }
    await ctx.setState({ data: { stage: 'asking', answers: 0 } });
    const requests = [];
    for (let amount = 0; amount < width; amount += 1) {
      requests.push(
        await ctx.build({ type: 'com_payment_charge', data: { amount } }),
      );
    }
    return requests;
  });
  return lattice;
};

describe('one execution asking two hundred at once', () => {
  it('runs it through, and answers its caller once', async () => {
    const lattice = fanOutLattice(200);
    await lattice.publish(anOrder()).settle();

    expect(lattice.store.size).toBe(201);
    expect(
      lattice.transcript.published.filter(
        (event) => event.to === 'com.web.checkout',
      ),
    ).toHaveLength(1);
  });

  it('awaits exactly this round, rather than every round so far', async () => {
    const lattice = fanOutLattice(200);
    await lattice.publish(anOrder()).settle();

    const orderRow = [...lattice.store.values()].find(
      (row) => row.source === orderV1.type,
    ) as Record<string, unknown[]>;

    // what it waits for is rebuilt from what it asked, not merged into
    expect(orderRow.inFlightEventMap).toHaveLength(200);
    // and its trail holds the event that opened it, what it asked, what
    // answered, and the one it sent its caller: nothing counted twice
    expect(orderRow.eventIds).toHaveLength(1 + 200 + 200 + 1);
  });

  it('commits once per answer, however wide the round was', async () => {
    const lattice = fanOutLattice(200);
    await lattice.publish(anOrder()).settle();

    // Every answer rewrites the record, which holds the whole
    // collection, so the work rises with the square of the width by
    // design — ADR-007 names that cost and accepts it. What must not
    // also rise is the number of rounds: one per worker, one per
    // answer, and one more for the order itself.
    expect(lattice.transcript.committed).toHaveLength(200 + 200 + 1);
  });
});

describe('two hundred executions deep', () => {
  it('runs the chain through, and answers the first caller', async () => {
    const lattice = createArvoLattice({
      versions: declareVersions({ [walkV1.type]: { maxDepth: 10_000 } }),
      seed: 77,
    });
    await lattice.publish(aWalk(200)).settle();

    expect(lattice.store.size).toBe(201);
    expect(
      lattice.transcript.published.filter(
        (event) => event.to === 'com.web.start',
      ),
    ).toHaveLength(1);
    await checkInvariants(lattice);
  });
});

describe('two thousand executions through one version', () => {
  it('holds nothing of one execution that another can see', async () => {
    const versions = declareVersions();
    const version = versions[orderV1.type]?.['1.0.0'];
    const rememberedStages: string[] = [];

    for (let orderIndex = 0; orderIndex < 2_000; orderIndex += 1) {
      const event = anOrder(`order-${orderIndex}`);
      const response = (await version?.execute({
        entry: 'init',
        event,
        state: null,
        executionId: await deriveArvoExecutionId(event),
        attempt: 0,
        dependencies: heldDependencies({
          behave: async (ctx: OrderContext) => {
            await ctx.setState({
              data: { stage: ctx.state.subject, answers: orderIndex },
            });
            return ctx.build({
              type: 'evt_order_fulfilled',
              data: { order_id: ctx.state.subject },
            });
          },
        }).dependency,
        hooks: {},
        telemetry: executionTelemetry(),
      } as never)) as ArvoEventHandlerExecuteResponse;

      if (response.kind !== 'produced') throw new Error('expected a produce');
      rememberedStages.push((response.state.data as { stage: string }).stage);
    }

    // every execution remembered its own workflow and nobody else's
    expect(new Set(rememberedStages).size).toBe(2_000);
    expect(rememberedStages[0]).toBe('order-0');
    expect(rememberedStages.at(-1)).toBe('order-1999');
  });

  it('keeps two executions apart while both are part way through', async () => {
    const versions = declareVersions();
    const version = versions[orderV1.type]?.['1.0.0'];
    const checkpoints: string[] = [];

    /** An executor that yields part way, so the other runs inside it. */
    const yieldingExecutor = async (ctx: OrderContext) => {
      checkpoints.push(`${ctx.state.subject} entered`);
      await ctx.setState({ data: { stage: ctx.state.subject, answers: 0 } });
      await new Promise((resolve) => setTimeout(resolve, 5));
      checkpoints.push(
        `${ctx.state.subject} resumed as ${ctx.state.data?.stage}`,
      );
      return ctx.build({
        type: 'evt_order_fulfilled',
        data: { order_id: ctx.state.data?.stage ?? 'lost' },
      });
    };

    const runOrder = async (subject: string) => {
      const event = anOrder(subject);
      return (await version?.execute({
        entry: 'init',
        event,
        state: null,
        executionId: await deriveArvoExecutionId(event),
        attempt: 0,
        dependencies: heldDependencies({ behave: yieldingExecutor }).dependency,
        hooks: {},
        telemetry: executionTelemetry(),
      } as never)) as ArvoEventHandlerExecuteResponse;
    };

    const [responseA, responseB] = await Promise.all([
      runOrder('order-a'),
      runOrder('order-b'),
    ]);

    if (responseA?.kind !== 'produced' || responseB?.kind !== 'produced') {
      throw new Error('expected both to produce');
    }
    expect(responseA.events[0]?.data.order_id).toBe('order-a');
    expect(responseB.events[0]?.data.order_id).toBe('order-b');
    expect(checkpoints).toContain('order-a resumed as order-a');
    expect(checkpoints).toContain('order-b resumed as order-b');
  });
});

describe('telemetry that fights back', () => {
  /** A span, meter and logger that throw at every opportunity. */
  const hostileTelemetry = () => {
    const span = trace.getTracer('scale').startSpan('execution');
    const throwingSpan = new Proxy(span, {
      get(target, property) {
        if (property === 'spanContext') return () => target.spanContext();
        return () => {
          throw new Error(`the collector refused ${String(property)}`);
        };
      },
    }) as Span;

    return new ArvoExecutionContextTelemetry({
      span: throwingSpan,
      meter: null,
      logger: {
        emit: () => {
          throw new Error('the log pipeline is down');
        },
      },
    });
  };

  it('does not decide whether a workflow completes', async () => {
    const versions = declareVersions();
    const event = anOrder('order-telemetry');

    const response = (await versions[orderV1.type]?.['1.0.0']?.execute({
      entry: 'init',
      event,
      state: null,
      executionId: await deriveArvoExecutionId(event),
      attempt: 0,
      dependencies: heldDependencies({
        behave: async (ctx: OrderContext) => {
          await ctx.setState({ data: { stage: 'done', answers: 0 } });
          return ctx.build({
            type: 'evt_order_fulfilled',
            data: { order_id: 'o-1' },
          });
        },
      }).dependency,
      hooks: {},
      telemetry: hostileTelemetry(),
    } as never)) as ArvoEventHandlerExecuteResponse;

    expect(response.kind).toBe('produced');
  });

  it('does not turn a fault into something else on the way out', async () => {
    const versions = declareVersions();
    const event = anOrder('order-telemetry-2');

    await expect(
      versions[orderV1.type]?.['1.0.0']?.execute({
        entry: 'init',
        event,
        state: null,
        executionId: await deriveArvoExecutionId(event),
        attempt: 0,
        dependencies: heldDependencies({
          behave: async (ctx: OrderContext) => {
            await ctx.setState({ data: { stage: 'done', answers: 0 } });
            return 'not an event';
          },
        }).dependency,
        hooks: {},
        telemetry: hostileTelemetry(),
      } as never),
    ).rejects.toMatchObject({ faultKind: 'emission_not_permitted' });
  });
});
