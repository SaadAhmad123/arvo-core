import { describe, expect, it } from 'vitest';
import type { IArvoEventHandlerMiddleware } from '../../../src/ArvoEventHandler/types/middleware.js';
import { chanceFrom } from '../version/scenarios/chance.js';
import {
  answeringExecutor,
  executeOrder,
  orderHandler,
  orderRequest,
  sleep,
} from './fixture.js';

/**
 * Many executions at once through one handler.
 *
 * Each execution answers with what its layers left for it, so an answer
 * carrying another execution's subject is cross-talk made visible.
 */

const AT_ONCE = 100;

/** The waits, drawn from one seed, so every run interleaves from the same sequence. */
const nextWaitFraction = chanceFrom(16);

/** Waits a moment chosen per call, so executions interleave. */
const waitRandomly = () => sleep(nextWaitFraction() * 4);

const readAnswer = (
  executionResult: Awaited<ReturnType<typeof executeOrder>>,
): { subject: string; orderId: string } | null => {
  if (!executionResult.ok || executionResult.value.kind !== 'produced')
    return null;
  const event = executionResult.value.events[0];
  if (event === undefined) return null;
  return {
    subject: event.subject,
    orderId: (event.data as { order_id: string }).order_id,
  };
};

const executeManyOrders = (handler: ReturnType<typeof orderHandler>) =>
  Promise.all(
    Array.from({ length: AT_ONCE }, (_, orderIndex) =>
      executeOrder(handler, { event: orderRequest(`order-${orderIndex}`) }),
    ),
  );

describe('a shared layer writing middleware data', () => {
  it('keeps each execution its own data', async () => {
    const sharedLayer: IArvoEventHandlerMiddleware = {
      id: 'shared',
      before: async (ctx) => {
        await waitRandomly();
        await ctx.setMiddleware('marker', ctx.state.subject);
        await waitRandomly();
      },
    };
    const handler = orderHandler({
      middleware: [sharedLayer],
      execute: async (ctx) => {
        await waitRandomly();
        await ctx.setState({ data: { stage: 'answered' } });
        return ctx.build({
          type: 'com_order_created',
          data: { order_id: ctx.middleware.marker as string },
        });
      },
    });
    const answers = (await executeManyOrders(handler)).map(readAnswer);
    expect(
      answers.every(
        (answer) => answer !== null && answer.orderId === answer.subject,
      ),
    ).toBe(true);
  });
});

describe('a layer made per execution, holding what it learns on itself', () => {
  it('keeps each execution its own instance', async () => {
    const handler = orderHandler({
      middleware: [
        () => {
          let heldSubject = '';
          return {
            id: 'made',
            before: async (ctx) => {
              heldSubject = ctx.state.subject;
              await waitRandomly();
            },
            after: async (ctx) => {
              await waitRandomly();
              if (heldSubject !== ctx.state.subject) {
                throw new Error(`held ${heldSubject} for ${ctx.state.subject}`);
              }
            },
          } satisfies IArvoEventHandlerMiddleware;
        },
      ],
      execute: async (ctx) => {
        await waitRandomly();
        return answeringExecutor(ctx);
      },
    });
    const executionResults = await executeManyOrders(handler);
    expect(
      executionResults.every(
        (executionResult) =>
          executionResult.ok && executionResult.value.kind === 'produced',
      ),
    ).toBe(true);
  });

  it('is made exactly once per execution', async () => {
    let layersMade = 0;
    const handler = orderHandler({
      middleware: [
        () => {
          layersMade += 1;
          return { id: 'made' };
        },
      ],
    });
    await executeManyOrders(handler);
    expect(layersMade).toBe(AT_ONCE);
  });
});

describe('a shared layer that keeps one execution on itself, against the rule', () => {
  it('mixes executions up under concurrency — which is why the rule exists', async () => {
    class Careless implements IArvoEventHandlerMiddleware<'careless'> {
      readonly id = 'careless' as const;
      subject = '';
      async before(ctx: { state: { subject: string } }) {
        this.subject = ctx.state.subject;
        await waitRandomly();
      }
    }
    const carelessLayer = new Careless();
    let mixedUpCount = 0;
    const handler = orderHandler({
      middleware: [carelessLayer as never],
      execute: async (ctx) => {
        await waitRandomly();
        if (carelessLayer.subject !== ctx.state.subject) mixedUpCount += 1;
        return answeringExecutor(ctx);
      },
    });
    await executeManyOrders(handler);
    expect(mixedUpCount).toBeGreaterThan(0);
  });
});
