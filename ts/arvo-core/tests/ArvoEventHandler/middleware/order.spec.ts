import { describe, expect, it } from 'vitest';
import type { IArvoEventHandlerMiddleware } from '../../../src/ArvoEventHandler/types/middleware.js';
import { answering, logging, openOne, orderHandler, sleep } from './fixture.js';

/** Order and shape, at sizes from none to many. */

describe('the order, at every size', () => {
  it.each([0, 1, 2, 50, 500])(
    'is exact with %i declared layers',
    async (count) => {
      const { log, layer, execute } = logging();
      const ids = Array.from({ length: count }, (_, index) => `l${index}`);
      const ran = await openOne(
        orderHandler({ execute, middleware: ids.map((id) => layer(id)) }),
      );
      expect(ran.ok).toBe(true);
      expect(log).toEqual([
        ...ids.map((id) => `${id}.before`),
        'executor',
        ...[...ids].reverse().map((id) => `${id}.after`),
      ]);
    },
  );

  it('is exact with only supplied layers', async () => {
    const { log, layer, execute } = logging();
    await openOne(orderHandler({ execute }), {
      middleware: [layer('a'), layer('b')],
    });
    expect(log).toEqual([
      'a.before',
      'b.before',
      'executor',
      'b.after',
      'a.after',
    ]);
  });

  it('passes over a layer with neither part among others', async () => {
    const { log, layer, execute } = logging();
    await openOne(
      orderHandler({
        execute,
        middleware: [layer('a'), { id: 'empty' }, layer('b')],
      }),
    );
    expect(log).toEqual([
      'a.before',
      'b.before',
      'executor',
      'b.after',
      'a.after',
    ]);
  });

  it('happens in time as well as in sequence', async () => {
    const stamps: [string, number][] = [];
    const stamped = (id: string): IArvoEventHandlerMiddleware => ({
      id,
      before: async () => {
        stamps.push([`${id}.before`, performance.now()]);
        await sleep(1);
      },
      after: async () => {
        stamps.push([`${id}.after`, performance.now()]);
        await sleep(1);
      },
    });
    await openOne(
      orderHandler({
        middleware: [stamped('a'), stamped('b')],
        execute: async (ctx) => {
          stamps.push(['executor', performance.now()]);
          return answering(ctx);
        },
      }),
    );
    const times = stamps.map(([, at]) => at);
    expect(times).toEqual([...times].sort((x, y) => x - y));
  });
});

describe('one layer on several handlers', () => {
  it('serves both, holding nothing of either', async () => {
    const seen: string[] = [];
    const shared: IArvoEventHandlerMiddleware = {
      id: 'shared',
      before: (ctx) => void seen.push(ctx.state.subject),
    };
    await openOne(orderHandler({ middleware: [shared] }));
    await openOne(orderHandler({ middleware: [shared] }));
    expect(seen).toHaveLength(2);
  });
});

describe('time a before part takes', () => {
  it('is time the executor no longer has', async () => {
    let remaining: number | null = null;
    await openOne(
      orderHandler({
        runTimeout: 500,
        middleware: [{ id: 'slow', before: () => sleep(60) }],
        execute: async (ctx) => {
          remaining = ctx.timeRemaining.run;
          return answering(ctx);
        },
      }),
    );
    expect(remaining).not.toBeNull();
    expect(remaining as unknown as number).toBeLessThanOrEqual(500 - 55);
  });
});
