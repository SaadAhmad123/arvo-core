import { describe, expect, it } from 'vitest';
import type { IArvoEventHandlerMiddleware } from '../../../src/ArvoEventHandler/types/middleware.js';
import {
  answering,
  openOne,
  orderHandler,
  recordingSpan,
  sleep,
} from './fixture.js';

/** What an execution with layers leaves on its span and its meter. */

const both = (id: string): IArvoEventHandlerMiddleware => ({
  id,
  before: () => undefined,
  after: () => undefined,
});

describe('spans', () => {
  it.each([0, 1, 50])('is exactly one span with %i layers', async (count) => {
    const probe = recordingSpan();
    await openOne(
      orderHandler({
        tracer: probe.tracer,
        middleware: Array.from({ length: count }, (_, index) =>
          both(`l${index}`),
        ),
      }),
    );
    expect(probe.started()).toBe(1);
  });
});

describe('marks', () => {
  it('leaves one mark per part entered and per part returned', async () => {
    const probe = recordingSpan();
    await openOne(
      orderHandler({
        tracer: probe.tracer,
        middleware: [both('a'), both('b')],
      }),
    );
    expect(probe.marks()).toEqual([
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
    const probe = recordingSpan();
    await openOne(
      orderHandler({
        tracer: probe.tracer,
        middleware: [{ id: 'only_after', after: () => undefined }],
      }),
    );
    expect(probe.marks()).toEqual([
      ['middleware_after_entered', 'only_after'],
      ['middleware_after_returned', 'only_after'],
    ]);
  });

  it('marks a before part entered and not returned where it failed', async () => {
    const probe = recordingSpan();
    await openOne(
      orderHandler({
        tracer: probe.tracer,
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
    expect(probe.marks()).toEqual([['middleware_before_entered', 'broken']]);
  });

  it('marks a failed after part, and a cut chain', async () => {
    const probe = recordingSpan();
    await openOne(
      orderHandler({
        tracer: probe.tracer,
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
    const names = probe.events.map((each) => each.name);
    expect(names.some((name) => name.endsWith('middleware_after_failed'))).toBe(
      true,
    );
    expect(names.some((name) => name.endsWith('middleware_after_cut'))).toBe(
      true,
    );
  });
});

describe('the time recorded', () => {
  it('keeps the executor its own time, the layers around it counted apart', async () => {
    const recorded: Record<string, number[]> = {};
    const meter = {
      createHistogram: (name: string) => ({
        record: (value: number) => {
          recorded[name] = [...(recorded[name] ?? []), value];
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
    const { orderState, anOrder, storing } = await import('./fixture.js');
    const handler = setupArvoEventHandler({
      contracts: {
        self: orderContract,
        services: { payments: paymentVersion },
      },
      telemetry: { meter: meter as never },
      middleware: [
        { id: 'slow', before: () => sleep(60), after: () => sleep(60) },
      ],
    })
      .handler('1.0.0', { state: orderState, execute: answering as never })
      .build();
    await handler.tryExecute({
      event: anOrder(),
      state: storing().read(),
      attempt: 0,
    });

    const key = (part: string) =>
      Object.keys(recorded).find((name) => name.endsWith(part)) as string;
    const executor = recorded[key('executor.duration')]?.[0] as number;
    const layers = recorded[key('middleware.duration')]?.[0] as number;
    expect(executor).toBeLessThan(50);
    expect(layers).toBeGreaterThanOrEqual(110);
  });
});
