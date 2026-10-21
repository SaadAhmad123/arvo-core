import { describe, expect, it } from 'vitest';
import type { IArvoEventHandlerMiddleware } from '../../../src/ArvoEventHandler/types/middleware.js';
import {
  answeringExecutor,
  createPartLog,
  executeOrder,
  orderHandler,
  sleep,
} from './fixture.js';

/** Order and shape, at sizes from none to many. */

describe('the order, at every size', () => {
  it.each([0, 1, 2, 50, 500])(
    'is exact with %i declared layers',
    async (layerCount) => {
      const { partLog, loggingLayer, loggingExecutor } = createPartLog();
      const layerIds = Array.from(
        { length: layerCount },
        (_, layerIndex) => `l${layerIndex}`,
      );
      const executionResult = await executeOrder(
        orderHandler({
          execute: loggingExecutor,
          middleware: layerIds.map((layerId) => loggingLayer(layerId)),
        }),
      );
      expect(executionResult.ok).toBe(true);
      expect(partLog).toEqual([
        ...layerIds.map((layerId) => `${layerId}.before`),
        'executor',
        ...[...layerIds].reverse().map((layerId) => `${layerId}.after`),
      ]);
    },
  );

  it('is exact with only supplied layers', async () => {
    const { partLog, loggingLayer, loggingExecutor } = createPartLog();
    await executeOrder(orderHandler({ execute: loggingExecutor }), {
      middleware: [loggingLayer('a'), loggingLayer('b')],
    });
    expect(partLog).toEqual([
      'a.before',
      'b.before',
      'executor',
      'b.after',
      'a.after',
    ]);
  });

  it('passes over a layer with neither part among others', async () => {
    const { partLog, loggingLayer, loggingExecutor } = createPartLog();
    await executeOrder(
      orderHandler({
        execute: loggingExecutor,
        middleware: [loggingLayer('a'), { id: 'empty' }, loggingLayer('b')],
      }),
    );
    expect(partLog).toEqual([
      'a.before',
      'b.before',
      'executor',
      'b.after',
      'a.after',
    ]);
  });

  it('happens in time as well as in sequence', async () => {
    const partStamps: [string, number][] = [];
    const stampedLayer = (layerId: string): IArvoEventHandlerMiddleware => ({
      id: layerId,
      before: async () => {
        partStamps.push([`${layerId}.before`, performance.now()]);
        await sleep(1);
      },
      after: async () => {
        partStamps.push([`${layerId}.after`, performance.now()]);
        await sleep(1);
      },
    });
    await executeOrder(
      orderHandler({
        middleware: [stampedLayer('a'), stampedLayer('b')],
        execute: async (ctx) => {
          partStamps.push(['executor', performance.now()]);
          return answeringExecutor(ctx);
        },
      }),
    );
    const stampTimes = partStamps.map(([, at]) => at);
    expect(stampTimes).toEqual(
      [...stampTimes].sort((earlierTime, laterTime) => earlierTime - laterTime),
    );
  });
});

describe('one layer on several handlers', () => {
  it('serves both, holding nothing of either', async () => {
    const seenSubjects: string[] = [];
    const sharedLayer: IArvoEventHandlerMiddleware = {
      id: 'shared',
      before: (ctx) => void seenSubjects.push(ctx.state.subject),
    };
    await executeOrder(orderHandler({ middleware: [sharedLayer] }));
    await executeOrder(orderHandler({ middleware: [sharedLayer] }));
    expect(seenSubjects).toHaveLength(2);
  });
});

describe('time a before part takes', () => {
  it('is time the executor no longer has', async () => {
    let remainingRunMs: number | null = null;
    await executeOrder(
      orderHandler({
        runTimeout: 500,
        middleware: [{ id: 'slow', before: () => sleep(60) }],
        execute: async (ctx) => {
          remainingRunMs = ctx.timeRemaining.run;
          return answeringExecutor(ctx);
        },
      }),
    );
    expect(remainingRunMs).not.toBeNull();
    expect(remainingRunMs as unknown as number).toBeLessThanOrEqual(500 - 55);
  });
});
