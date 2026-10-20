import { describe, expect, it } from 'vitest';
import type { IArvoEventHandlerMiddleware } from '../../../src/ArvoEventHandler/types/middleware.js';
import { anOrder, answering, openOne, orderHandler, sleep } from './fixture.js';

/**
 * Many executions at once through one handler.
 *
 * Each execution answers with what its layers left for it, so an answer
 * carrying another execution's subject is cross-talk made visible.
 */

const AT_ONCE = 100;

/** Waits a moment chosen per call, so executions interleave. */
const jitter = () => sleep(Math.random() * 4);

const answerOf = (
  ran: Awaited<ReturnType<typeof openOne>>,
): { subject: string; orderId: string } | null => {
  if (!ran.ok || ran.value.kind !== 'produced') return null;
  const event = ran.value.events[0];
  if (event === undefined) return null;
  return {
    subject: event.subject,
    orderId: (event.data as { order_id: string }).order_id,
  };
};

const runMany = (handler: ReturnType<typeof orderHandler>) =>
  Promise.all(
    Array.from({ length: AT_ONCE }, (_, index) =>
      openOne(handler, { event: anOrder(`order-${index}`) }),
    ),
  );

describe('a shared layer writing middleware data', () => {
  it('keeps each execution its own data', async () => {
    const shared: IArvoEventHandlerMiddleware = {
      id: 'shared',
      before: async (ctx) => {
        await jitter();
        await ctx.setMiddleware('marker', ctx.state.subject);
        await jitter();
      },
    };
    const handler = orderHandler({
      middleware: [shared],
      execute: async (ctx) => {
        await jitter();
        await ctx.setState({ data: { stage: 'answered' } });
        return ctx.build({
          type: 'com_order_created',
          data: { order_id: ctx.middleware.marker as string },
        });
      },
    });
    const answers = (await runMany(handler)).map(answerOf);
    expect(
      answers.every((one) => one !== null && one.orderId === one.subject),
    ).toBe(true);
  });
});

describe('a layer made per execution, holding what it learns on itself', () => {
  it('keeps each execution its own instance', async () => {
    const handler = orderHandler({
      middleware: [
        () => {
          let held = '';
          return {
            id: 'made',
            before: async (ctx) => {
              held = ctx.state.subject;
              await jitter();
            },
            after: async (ctx) => {
              await jitter();
              if (held !== ctx.state.subject) {
                throw new Error(`held ${held} for ${ctx.state.subject}`);
              }
            },
          } satisfies IArvoEventHandlerMiddleware;
        },
      ],
      execute: async (ctx) => {
        await jitter();
        return answering(ctx);
      },
    });
    const results = await runMany(handler);
    expect(
      results.every((ran) => ran.ok && ran.value.kind === 'produced'),
    ).toBe(true);
  });

  it('is made exactly once per execution', async () => {
    let made = 0;
    const handler = orderHandler({
      middleware: [
        () => {
          made += 1;
          return { id: 'made' };
        },
      ],
    });
    await runMany(handler);
    expect(made).toBe(AT_ONCE);
  });
});

describe('a shared layer that keeps one execution on itself, against the rule', () => {
  it('mixes executions up under concurrency — which is why the rule exists', async () => {
    class Careless implements IArvoEventHandlerMiddleware<'careless'> {
      readonly id = 'careless' as const;
      subject = '';
      async before(ctx: { state: { subject: string } }) {
        this.subject = ctx.state.subject;
        await jitter();
      }
    }
    const careless = new Careless();
    let mixed = 0;
    const handler = orderHandler({
      middleware: [careless as never],
      execute: async (ctx) => {
        await jitter();
        if (careless.subject !== ctx.state.subject) mixed += 1;
        return answering(ctx);
      },
    });
    await runMany(handler);
    expect(mixed).toBeGreaterThan(0);
  });
});
