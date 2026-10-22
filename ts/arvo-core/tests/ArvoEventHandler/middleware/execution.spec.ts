import { describe, expect, it, vi } from 'vitest';
import type { IArvoEventHandlerMiddleware } from '../../../src/ArvoEventHandler/types/middleware.js';
import { orderVersion } from '../fixtures.js';
import {
  answeringExecutor,
  createInMemoryStore,
  createPartLog,
  executeOrder,
  orderHandler,
  orderRequest,
  recordingSpan,
  sleep,
} from './fixture.js';

/**
 * Layers through the handler, end to end: declared, supplied, made per
 * execution, and timed.
 */

const layerNamed = (id: string): IArvoEventHandlerMiddleware => ({ id });

describe('an execution with no layers anywhere', () => {
  it('produces exactly what it produced before layers existed', async () => {
    const executionResult = await executeOrder(orderHandler());
    expect(executionResult.ok && executionResult.value.kind).toBe('produced');
    expect(
      executionResult.ok &&
        executionResult.value.kind === 'produced' &&
        executionResult.value.events[0]?.type,
    ).toBe('com_order_created');
  });

  it('is the same with an empty list supplied', async () => {
    const executionResult = await executeOrder(orderHandler(), {
      middleware: [],
    });
    expect(executionResult.ok && executionResult.value.kind).toBe('produced');
  });

  it('marks no layer on the span', async () => {
    const spanRecorder = recordingSpan();
    await executeOrder(orderHandler(), { tracer: spanRecorder.tracer });
    expect(spanRecorder.marks()).toEqual([]);
  });
});

describe('the order layers run in, through the handler', () => {
  it('runs supplied before declared, then the executor, then the reverse', async () => {
    const { partLog, loggingLayer, loggingExecutor } = createPartLog();
    const handler = orderHandler({
      execute: loggingExecutor,
      middleware: [loggingLayer('declared_1'), loggingLayer('declared_2')],
    });
    await executeOrder(handler, {
      middleware: [loggingLayer('supplied_1'), loggingLayer('supplied_2')],
    });
    expect(partLog).toEqual([
      'supplied_1.before',
      'supplied_2.before',
      'declared_1.before',
      'declared_2.before',
      'executor',
      'declared_2.after',
      'declared_1.after',
      'supplied_2.after',
      'supplied_1.after',
    ]);
  });

  it('runs declared layers for every execution, and supplied ones for theirs only', async () => {
    const { partLog, loggingLayer, loggingExecutor } = createPartLog();
    const handler = orderHandler({
      execute: loggingExecutor,
      middleware: [loggingLayer('declared')],
    });
    await executeOrder(handler, {
      middleware: [loggingLayer('supplied')],
      event: orderRequest('a'),
    });
    await executeOrder(handler, { event: orderRequest('b') });
    expect(
      partLog.filter((logLine) => logLine.startsWith('supplied')),
    ).toHaveLength(2);
    expect(
      partLog.filter((logLine) => logLine.startsWith('declared')),
    ).toHaveLength(4);
  });
});

describe('what a before part can do to what the executor sees', () => {
  it('writes state the executor reads', async () => {
    let seenValue: unknown;
    const handler = orderHandler({
      middleware: [
        {
          id: 'stager',
          before: async (ctx) => {
            await (
              ctx as never as {
                setState: (stateUpdate: unknown) => Promise<void>;
              }
            ).setState({
              data: { stage: 'set-by-layer' },
            });
          },
        },
      ],
      execute: async (ctx) => {
        seenValue = ctx.state.data?.stage;
        return answeringExecutor(ctx);
      },
    });
    await executeOrder(handler);
    expect(seenValue).toBe('set-by-layer');
  });

  it('leaves middleware data the executor reads', async () => {
    let seenValue: unknown;
    const handler = orderHandler({
      middleware: [
        { id: 'tenant', before: (ctx) => ctx.setMiddleware('tenant', 't-1') },
      ],
      execute: async (ctx) => {
        seenValue = ctx.middleware.tenant;
        return answeringExecutor(ctx);
      },
    });
    await executeOrder(handler);
    expect(seenValue).toBe('t-1');
  });

  it('leaves middleware data an inner layer reads', async () => {
    let seenValue: unknown;
    const handler = orderHandler({
      middleware: [
        {
          id: 'inner',
          before: (ctx) => {
            seenValue = ctx.middleware.from_outside;
          },
        },
      ],
    });
    await executeOrder(handler, {
      middleware: [
        { id: 'outer', before: (ctx) => ctx.setMiddleware('from_outside', 42) },
      ],
    });
    expect(seenValue).toBe(42);
  });

  it('keeps middleware data out of the record produced', async () => {
    const handler = orderHandler({
      middleware: [
        {
          id: 'tenant',
          before: (ctx) => ctx.setMiddleware('tenant', 'not-in-the-record'),
        },
      ],
    });
    const executionResult = await executeOrder(handler);
    expect(
      JSON.stringify(
        executionResult.ok &&
          executionResult.value.kind === 'produced' &&
          executionResult.value.state,
      ),
    ).not.toContain('not-in-the-record');
  });
});

describe('a before part that fails, through the handler', () => {
  it('becomes the handler error event where it throws', async () => {
    const executorSpy = vi.fn(answeringExecutor);
    const handler = orderHandler({
      execute: executorSpy,
      middleware: [
        {
          id: 'broken',
          before: () => {
            throw new Error('layer broke');
          },
        },
      ],
    });
    const executionResult = await executeOrder(handler);
    expect(executionResult.ok).toBe(true);
    const producedValue =
      executionResult.ok && executionResult.value.kind === 'produced'
        ? executionResult.value
        : null;
    expect(producedValue?.events[0]?.type).toBe(orderVersion.error.type);
    expect(producedValue?.state.lifecycle).toBe('error');
    expect(executorSpy).not.toHaveBeenCalled();
  });

  it('stays a fault where it raises one through the context', async () => {
    const handler = orderHandler({
      middleware: [
        {
          id: 'refuser',
          before: async (ctx) => {
            throw await ctx.fault({
              faultKind: 'executor_raised',
              message: 'no tenant',
              retryable: false,
            });
          },
        },
      ],
    });
    const executionResult = await executeOrder(handler);
    expect(executionResult.ok).toBe(false);
    expect(!executionResult.ok && executionResult.error.faultKind).toBe(
      'executor_raised',
    );
    expect(!executionResult.ok && executionResult.error.retry).toBeNull();
  });

  it('keeps the retry verdict the layer chose', async () => {
    const handler = orderHandler({
      middleware: [
        {
          id: 'transient',
          before: async (ctx) => {
            throw await ctx.fault({
              faultKind: 'executor_raised',
              message: 'try again',
            });
          },
        },
      ],
    });
    const executionResult = await executeOrder(handler);
    expect(!executionResult.ok && executionResult.error.retry).not.toBeNull();
  });
});

describe('an after part, through the handler', () => {
  it('does not change what the execution produces when it throws', async () => {
    const handler = orderHandler({
      middleware: [
        {
          id: 'noisy',
          after: () => {
            throw new Error('after broke');
          },
        },
      ],
    });
    const executionResult = await executeOrder(handler);
    expect(
      executionResult.ok &&
        executionResult.value.kind === 'produced' &&
        executionResult.value.state.lifecycle,
    ).toBe('success');
  });

  it('does not make a fault of one raised through the context', async () => {
    const handler = orderHandler({
      middleware: [
        {
          id: 'noisy',
          after: async (ctx) => {
            throw await ctx.fault({
              faultKind: 'executor_raised',
              message: 'late',
            });
          },
        },
      ],
    });
    const executionResult = await executeOrder(handler);
    expect(executionResult.ok).toBe(true);
  });

  it('marks the failure on the span', async () => {
    const spanRecorder = recordingSpan();
    const handler = orderHandler({
      middleware: [
        {
          id: 'noisy',
          after: () => {
            throw new Error('after broke');
          },
        },
      ],
    });
    await executeOrder(handler, { tracer: spanRecorder.tracer });
    expect(spanRecorder.marks()).toContainEqual([
      'middleware_after_failed',
      'noisy',
    ]);
  });

  it('does not run where the executor threw', async () => {
    const afterSpy = vi.fn();
    const handler = orderHandler({
      middleware: [{ id: 'watcher', after: afterSpy }],
      execute: () => {
        throw new Error('executor broke');
      },
    });
    await executeOrder(handler);
    expect(afterSpy).not.toHaveBeenCalled();
  });

  it('sees a return that validation then refuses, and changes nothing about it', async () => {
    let seenValue: unknown;
    const handler = orderHandler({
      middleware: [
        {
          id: 'watcher',
          after: (_ctx, emission) => {
            seenValue = emission;
          },
        },
      ],
      execute: () => 'not an event' as never,
    });
    const executionResult = await executeOrder(handler);
    expect(seenValue).toBe('not an event');
    expect(!executionResult.ok && executionResult.error.faultKind).toBe(
      'emission_not_permitted',
    );
  });
});

describe('supplied identifiers', () => {
  it('refuses one a declared layer already carries, before anything runs', async () => {
    const executorSpy = vi.fn(answeringExecutor);
    const beforeSpy = vi.fn();
    const handler = orderHandler({
      execute: executorSpy,
      middleware: [{ id: 'same', before: beforeSpy }],
    });
    const executionResult = await executeOrder(handler, {
      middleware: [layerNamed('same')],
    });
    expect(!executionResult.ok && executionResult.error.faultKind).toBe(
      'middleware_conflict',
    );
    expect(!executionResult.ok && executionResult.error.retry).toBeNull();
    expect(!executionResult.ok && executionResult.error.message).toContain(
      'same',
    );
    expect(beforeSpy).not.toHaveBeenCalled();
    expect(executorSpy).not.toHaveBeenCalled();
  });

  it('refuses two supplied layers with one identifier', async () => {
    const executionResult = await executeOrder(orderHandler(), {
      middleware: [layerNamed('twice'), layerNamed('twice')],
    });
    expect(!executionResult.ok && executionResult.error.faultKind).toBe(
      'middleware_conflict',
    );
  });

  it('carries the pair a mechanism would abandon with', async () => {
    const executionResult = await executeOrder(orderHandler(), {
      middleware: [layerNamed('twice'), layerNamed('twice')],
    });
    expect(
      !executionResult.ok && executionResult.error.abandonmentEvent,
    ).not.toBeNull();
  });
});

describe('a way to make a layer', () => {
  it('is called once for each execution, declared', async () => {
    const makeLayer = vi.fn(() => layerNamed('made'));
    const handler = orderHandler({ middleware: [makeLayer] });
    await executeOrder(handler, { event: orderRequest('a') });
    await executeOrder(handler, { event: orderRequest('b') });
    expect(makeLayer).toHaveBeenCalledTimes(2);
  });

  it('is called once for the execution it was supplied to', async () => {
    const makeLayer = vi.fn(() => layerNamed('made'));
    await executeOrder(orderHandler(), { middleware: [makeLayer] });
    expect(makeLayer).toHaveBeenCalledTimes(1);
  });

  it('gives each execution its own instance, which may hold what it learns', async () => {
    const instances: object[] = [];
    class Stopwatch implements IArvoEventHandlerMiddleware<'stopwatch'> {
      readonly id = 'stopwatch' as const;
      startedAt = 0;
      took = -1;
      constructor() {
        instances.push(this);
      }
      before() {
        this.startedAt = Date.now();
      }
      after() {
        this.took = Date.now() - this.startedAt;
      }
    }
    const handler = orderHandler({ middleware: [() => new Stopwatch()] });
    await executeOrder(handler, { event: orderRequest('a') });
    await executeOrder(handler, { event: orderRequest('b') });
    expect(instances).toHaveLength(2);
    expect(instances[0]).not.toBe(instances[1]);
    expect(
      (instances as Stopwatch[]).every((stopwatch) => stopwatch.took >= 0),
    ).toBe(true);
  });

  it('may be asynchronous', async () => {
    const beforeSpy = vi.fn();
    await executeOrder(orderHandler(), {
      middleware: [async () => ({ id: 'async', before: beforeSpy })],
    });
    expect(beforeSpy).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      'throws',
      () => {
        throw new Error('no config');
      },
    ],
    ['returns nothing', () => undefined],
    ['returns null', () => null],
    ['returns an object with no identifier', () => ({})],
    ['returns an identifier that is not a string', () => ({ id: 9 })],
    ['rejects', () => Promise.reject(new Error('later'))],
  ])(
    'fails the execution as no further attempt fixes, where it %s',
    async (_label, makeLayer) => {
      const executorSpy = vi.fn(answeringExecutor);
      const executionResult = await executeOrder(
        orderHandler({ execute: executorSpy }),
        {
          middleware: [makeLayer as never],
        },
      );
      expect(!executionResult.ok && executionResult.error.faultKind).toBe(
        'middleware_instantiation_failed',
      );
      expect(!executionResult.ok && executionResult.error.retry).toBeNull();
      expect(executorSpy).not.toHaveBeenCalled();
    },
  );

  it('is refused where what it makes repeats an identifier', async () => {
    const executionResult = await executeOrder(
      orderHandler({ middleware: [layerNamed('same')] }),
      {
        middleware: [() => layerNamed('same')],
      },
    );
    expect(!executionResult.ok && executionResult.error.faultKind).toBe(
      'middleware_conflict',
    );
  });
});

describe('the run clock over the layers', () => {
  it('runs out in a slow before part as a run timeout, the executor never entered', async () => {
    const executorSpy = vi.fn(answeringExecutor);
    const handler = orderHandler({
      runTimeout: 20,
      execute: executorSpy,
      middleware: [{ id: 'slow', before: () => sleep(80) }],
    });
    const executionResult = await executeOrder(handler);
    expect(!executionResult.ok && executionResult.error.faultKind).toBe(
      'run_timeout',
    );
    await sleep(80);
    expect(executorSpy).not.toHaveBeenCalled();
  });

  it('runs out in a slow after part with the executor return standing', async () => {
    const spanRecorder = recordingSpan();
    const skippedAfterPart = vi.fn();
    const handler = orderHandler({
      runTimeout: 30,
      middleware: [
        { id: 'later', after: skippedAfterPart },
        { id: 'slow', after: () => sleep(120) },
      ],
    });
    const executionResult = await executeOrder(handler, {
      tracer: spanRecorder.tracer,
    });
    expect(
      executionResult.ok &&
        executionResult.value.kind === 'produced' &&
        executionResult.value.state.lifecycle,
    ).toBe('success');
    await sleep(150);
    expect(skippedAfterPart).not.toHaveBeenCalled();
    expect(
      spanRecorder.events.some((spanEvent) =>
        spanEvent.name.endsWith('middleware_after_cut'),
      ),
    ).toBe(true);
  });

  it('does not refuse for time an execution whose after part ran past the execution clock', async () => {
    const handler = orderHandler({
      runTimeout: 60,
      executionTimeout: 60,
      middleware: [{ id: 'slow', after: () => sleep(120) }],
    });
    const executionResult = await executeOrder(handler, {
      event: orderRequest(),
    });
    expect(executionResult.ok).toBe(true);
  });

  it('cuts nothing where the run clock is unbounded', async () => {
    const afterSpy = vi.fn();
    const handler = orderHandler({
      runTimeout: null,
      executionTimeout: null,
      middleware: [
        { id: 'checked', after: afterSpy },
        { id: 'slow', after: () => sleep(40) },
      ],
    });
    await executeOrder(handler);
    expect(afterSpy).toHaveBeenCalledTimes(1);
  });
});

describe('where layers do not run', () => {
  it('runs none where the gate refuses the event', async () => {
    const beforeSpy = vi.fn();
    const store = createInMemoryStore();
    const handler = orderHandler({
      middleware: [{ id: 'watch', before: beforeSpy }],
    });
    const orderEvent = orderRequest();

    const firstResult = await executeOrder(handler, {
      store,
      event: orderEvent,
    });
    if (firstResult.ok && firstResult.value.kind === 'produced')
      store.commit(firstResult.value.state);
    expect(beforeSpy).toHaveBeenCalledTimes(1);

    // the same opening event again: an execution exists, so the gate refuses it
    const repeatedResult = await executeOrder(handler, {
      store,
      event: orderEvent,
    });
    expect(!repeatedResult.ok && repeatedResult.error.faultKind).toBe(
      'record_unexpected',
    );
    expect(beforeSpy).toHaveBeenCalledTimes(1);
  });
});

describe('the span', () => {
  it('is one span however many layers there are', async () => {
    const spanRecorder = recordingSpan();
    const manyLayers = Array.from({ length: 50 }, (_, layerIndex) => ({
      id: `l${layerIndex}`,
      before: () => undefined,
      after: () => undefined,
    }));
    await executeOrder(orderHandler({ middleware: manyLayers }), {
      tracer: spanRecorder.tracer,
    });
    expect(spanRecorder.spansStarted()).toBe(1);
  });

  it('marks each part entered and returned, by identifier, in order', async () => {
    const spanRecorder = recordingSpan();
    await executeOrder(
      orderHandler({
        middleware: [
          { id: 'declared', before: () => undefined, after: () => undefined },
        ],
      }),
      {
        tracer: spanRecorder.tracer,
        middleware: [{ id: 'supplied', before: () => undefined }],
      },
    );
    expect(spanRecorder.marks()).toEqual([
      ['middleware_before_entered', 'supplied'],
      ['middleware_before_returned', 'supplied'],
      ['middleware_before_entered', 'declared'],
      ['middleware_before_returned', 'declared'],
      ['middleware_after_entered', 'declared'],
      ['middleware_after_returned', 'declared'],
    ]);
  });
});
