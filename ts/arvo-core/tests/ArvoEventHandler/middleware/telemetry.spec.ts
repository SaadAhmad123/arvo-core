import { describe, expect, it } from 'vitest';
import type { IArvoEventHandlerMiddleware } from '../../../src/ArvoEventHandler/types/middleware.js';
import {
  answeringExecutor,
  executeOrder,
  orderHandler,
  recordingSpan,
  sleep,
} from './fixture.js';

/** What an execution with layers leaves on its span and its meter. */

const layerWithBothParts = (id: string): IArvoEventHandlerMiddleware => ({
  id,
  before: () => undefined,
  after: () => undefined,
});

describe('spans', () => {
  it.each([0, 1, 50])(
    'is exactly one span with %i layers',
    async (layerCount) => {
      const spanRecorder = recordingSpan();
      await executeOrder(
        orderHandler({
          tracer: spanRecorder.tracer,
          middleware: Array.from({ length: layerCount }, (_, index) =>
            layerWithBothParts(`l${index}`),
          ),
        }),
      );
      expect(spanRecorder.spansStarted()).toBe(1);
    },
  );
});

describe('marks', () => {
  it('leaves one mark per part entered and per part returned', async () => {
    const spanRecorder = recordingSpan();
    await executeOrder(
      orderHandler({
        tracer: spanRecorder.tracer,
        middleware: [layerWithBothParts('a'), layerWithBothParts('b')],
      }),
    );
    expect(spanRecorder.marks()).toEqual([
      ['middleware_before_entered', 'a'],
      ['middleware_before_returned', 'a'],
      ['middleware_before_entered', 'b'],
      ['middleware_before_returned', 'b'],
      ['middleware_after_entered', 'b'],
      ['middleware_after_returned', 'b'],
      ['middleware_after_entered', 'a'],
      ['middleware_after_returned', 'a'],
    ]);
  });

  it('marks no part a layer does not have', async () => {
    const spanRecorder = recordingSpan();
    await executeOrder(
      orderHandler({
        tracer: spanRecorder.tracer,
        middleware: [{ id: 'only_after', after: () => undefined }],
      }),
    );
    expect(spanRecorder.marks()).toEqual([
      ['middleware_after_entered', 'only_after'],
      ['middleware_after_returned', 'only_after'],
    ]);
  });

  it('marks a before part entered and not returned where it failed', async () => {
    const spanRecorder = recordingSpan();
    await executeOrder(
      orderHandler({
        tracer: spanRecorder.tracer,
        middleware: [
          {
            id: 'broken',
            before: () => {
              throw new Error('boom');
            },
          },
        ],
      }),
    );
    expect(spanRecorder.marks()).toEqual([
      ['middleware_before_entered', 'broken'],
    ]);
  });

  it('marks a failed after part, and a cut chain', async () => {
    const spanRecorder = recordingSpan();
    await executeOrder(
      orderHandler({
        tracer: spanRecorder.tracer,
        runTimeout: 30,
        middleware: [
          { id: 'slow', after: () => sleep(100) },
          {
            id: 'broken',
            after: () => {
              throw new Error('boom');
            },
          },
        ],
      }),
    );
    const markNames = spanRecorder.events.map((spanEvent) => spanEvent.name);
    expect(
      markNames.some((name) => name.endsWith('middleware_after_failed')),
    ).toBe(true);
    expect(
      markNames.some((name) => name.endsWith('middleware_after_cut')),
    ).toBe(true);
  });
});

describe('the time recorded', () => {
  it('keeps the executor its own time, the layers around it counted apart', async () => {
    const recordedHistograms: Record<string, number[]> = {};
    const recordingMeter = {
      createHistogram: (name: string) => ({
        record: (value: number) => {
          recordedHistograms[name] = [
            ...(recordedHistograms[name] ?? []),
            value,
          ];
        },
      }),
      createCounter: () => ({ add: () => undefined }),
      createUpDownCounter: () => ({ add: () => undefined }),
      createGauge: () => ({ record: () => undefined }),
      createObservableGauge: () => ({ addCallback: () => undefined }),
      createObservableCounter: () => ({ addCallback: () => undefined }),
      createObservableUpDownCounter: () => ({ addCallback: () => undefined }),
      addBatchObservableCallback: () => undefined,
      removeBatchObservableCallback: () => undefined,
    };
    const { setupArvoEventHandler } = await import(
      '../../../src/factories/setupArvoEventHandler.js'
    );
    const { orderContract, paymentVersion } = await import('../fixtures.js');
    const { orderState, orderRequest, createInMemoryStore } = await import(
      './fixture.js'
    );
    const handler = setupArvoEventHandler({
      contracts: {
        self: orderContract,
        services: { payments: paymentVersion },
      },
      telemetry: { meter: recordingMeter as never },
      middleware: [
        { id: 'slow', before: () => sleep(60), after: () => sleep(60) },
      ],
    })
      .handler('1.0.0', {
        state: orderState,
        execute: answeringExecutor as never,
      })
      .build();
    await handler.tryExecute({
      event: orderRequest(),
      state: createInMemoryStore().read(),
      attempt: 0,
    });

    const metricNamed = (part: string) =>
      Object.keys(recordedHistograms).find((name) =>
        name.endsWith(part),
      ) as string;
    const executorDurationMs = recordedHistograms[
      metricNamed('executor.duration')
    ]?.[0] as number;
    const middlewareDurationMs = recordedHistograms[
      metricNamed('middleware.duration')
    ]?.[0] as number;
    expect(executorDurationMs).toBeLessThan(50);
    expect(middlewareDurationMs).toBeGreaterThanOrEqual(110);
  });
});
