import { describe, expect, it, vi } from 'vitest';
import type { ArvoExecutionContext } from '../../../src/ArvoEventHandler/context/index.js';
import type { ArvoExecutorEmission } from '../../../src/ArvoEventHandler/types/execute.js';
import type {
  ArvoEventHandlerMiddlewareEntry,
  IArvoEventHandlerMiddleware,
} from '../../../src/ArvoEventHandler/types/middleware.js';
import {
  type ArvoMiddlewareProgress,
  createArvoMiddlewareProgress,
  resolveMiddleware,
  runMiddleware,
} from '../../../src/ArvoEventHandler/version/middleware.js';
import { initEvent, telemetry } from '../fixtures.js';

/**
 * Running the layers around an executor, on their own.
 *
 * The context is a stand-in: running the chain passes it through and
 * reads nothing off it, which is itself one of the things checked here.
 */

const ctx = { stand: 'in' } as unknown as ArvoExecutionContext;

/** A log every part writes to, in the order things happened. */
const createPartLog = () => {
  const partLog: string[] = [];
  const layerNamed = (
    layerId: string,
    parts: { before?: boolean; after?: boolean } = {
      before: true,
      after: true,
    },
  ): IArvoEventHandlerMiddleware => ({
    id: layerId,
    ...(parts.before
      ? { before: () => void partLog.push(`${layerId}.before`) }
      : {}),
    ...(parts.after
      ? { after: () => void partLog.push(`${layerId}.after`) }
      : {}),
  });
  const loggingExecutorFor = (returned: ArvoExecutorEmission = [initEvent]) =>
    vi.fn(() => {
      partLog.push('executor');
      return returned;
    });
  return { log: partLog, layer: layerNamed, executor: loggingExecutorFor };
};

const runChain = (
  layers: readonly IArvoEventHandlerMiddleware[] | null,
  loggingExecutorFor: (executionContext: ArvoExecutionContext) => unknown,
  middlewareProgress: ArvoMiddlewareProgress = createArvoMiddlewareProgress(),
  executionTelemetry = telemetry().telemetry,
) =>
  runMiddleware({
    layers,
    ctx,
    executor: loggingExecutorFor as (
      executionContext: ArvoExecutionContext,
    ) => ArvoExecutorEmission,
    telemetry: executionTelemetry,
    middlewareProgress,
  });

describe('with no layers', () => {
  it('runs the executor alone and reports what it returned', async () => {
    const { executor: loggingExecutorFor } = createPartLog();
    const executionResult = await runChain(null, loggingExecutorFor());
    expect(executionResult).toEqual({
      kind: 'returned',
      emission: [initEvent],
    });
  });

  it('runs it exactly once', async () => {
    const { executor: loggingExecutorFor } = createPartLog();
    const executorSpy = loggingExecutorFor();
    await runChain([], executorSpy);
    expect(executorSpy).toHaveBeenCalledTimes(1);
  });

  it('notes when the executor started and returned', async () => {
    const middlewareProgress = createArvoMiddlewareProgress();
    const { executor: loggingExecutorFor } = createPartLog();
    await runChain(null, loggingExecutorFor(), middlewareProgress);
    expect(middlewareProgress.executorStartedAt).toBeTypeOf('number');
    expect(middlewareProgress.returnedAt).toBeGreaterThanOrEqual(
      middlewareProgress.executorStartedAt as number,
    );
  });
});

describe('the order layers run in', () => {
  it('runs before parts in order, then the executor, then after parts in reverse', async () => {
    const {
      log: partLog,
      layer: layerNamed,
      executor: loggingExecutorFor,
    } = createPartLog();
    await runChain(
      [layerNamed('a'), layerNamed('b'), layerNamed('c')],
      loggingExecutorFor(),
    );
    expect(partLog).toEqual([
      'a.before',
      'b.before',
      'c.before',
      'executor',
      'c.after',
      'b.after',
      'a.after',
    ]);
  });

  it('skips the part a layer does not have', async () => {
    const {
      log: partLog,
      layer: layerNamed,
      executor: loggingExecutorFor,
    } = createPartLog();
    await runChain(
      [
        layerNamed('a', { before: true }),
        layerNamed('b', { after: true }),
        layerNamed('c', {}),
      ],
      loggingExecutorFor(),
    );
    expect(partLog).toEqual(['a.before', 'executor', 'b.after']);
  });

  it('keeps the order across many layers', async () => {
    const {
      log: partLog,
      layer: layerNamed,
      executor: loggingExecutorFor,
    } = createPartLog();
    const layerIds = Array.from({ length: 500 }, (_, index) => `l${index}`);
    await runChain(
      layerIds.map((layerId) => layerNamed(layerId)),
      loggingExecutorFor(),
    );
    expect(partLog).toEqual([
      ...layerIds.map((layerId) => `${layerId}.before`),
      'executor',
      ...[...layerIds].reverse().map((layerId) => `${layerId}.after`),
    ]);
  });

  it('waits for a part that is asynchronous before running the next', async () => {
    const partLog: string[] = [];
    const slowLayer: IArvoEventHandlerMiddleware = {
      id: 'slow',
      before: async () => {
        await new Promise((settle) => setTimeout(settle, 5));
        partLog.push('slow.before');
      },
    };
    await runChain([slowLayer], () => {
      partLog.push('executor');
    });
    expect(partLog).toEqual(['slow.before', 'executor']);
  });
});

describe('what each part is given', () => {
  it('gives every part the same context the executor is given', async () => {
    const seenValues: unknown[] = [];
    const layerNamed: IArvoEventHandlerMiddleware = {
      id: 'seer',
      before: (executionContext) => void seenValues.push(executionContext),
      after: (executionContext) => void seenValues.push(executionContext),
    };
    await runChain([layerNamed], (executionContext) => {
      seenValues.push(executionContext);
    });
    expect(seenValues).toEqual([ctx, ctx, ctx]);
    expect(seenValues.every((seenContext) => seenContext === ctx)).toBe(true);
  });

  it('gives an after part what the executor returned', async () => {
    let seenValues: unknown;
    await runChain(
      [
        {
          id: 'a',
          after: (_ctx, emission) => {
            seenValues = emission;
          },
        },
      ],
      () => [initEvent],
    );
    expect(seenValues).toEqual([initEvent]);
  });

  it('gives an after part a list nothing can change', async () => {
    let pushError: unknown;
    const executionResult = await runChain(
      [
        {
          id: 'a',
          after: (_ctx, emission) => {
            try {
              (emission as unknown[]).push('extra');
            } catch (thrown) {
              pushError = thrown;
            }
          },
        },
      ],
      () => [initEvent],
    );
    expect(pushError).toBeInstanceOf(TypeError);
    expect(executionResult).toEqual({
      kind: 'returned',
      emission: [initEvent],
    });
  });

  it('gives an after part nothing where the executor returned nothing', async () => {
    let seenValues: unknown = 'unset';
    await runChain(
      [
        {
          id: 'a',
          after: (_ctx, emission) => {
            seenValues = emission;
          },
        },
      ],
      () => undefined,
    );
    expect(seenValues).toBeUndefined();
  });

  it('calls each part as a method of its layer', async () => {
    class Counter implements IArvoEventHandlerMiddleware<'counter'> {
      readonly id = 'counter' as const;
      calls = 0;
      before() {
        this.calls += 1;
      }
      after() {
        this.calls += 1;
      }
    }
    const counterLayer = new Counter();
    await runChain([counterLayer], () => undefined);
    expect(counterLayer.calls).toBe(2);
  });
});

describe('a before part that fails', () => {
  it('stops everything after it and reports what it raised', async () => {
    const {
      log: partLog,
      layer: layerNamed,
      executor: loggingExecutorFor,
    } = createPartLog();
    const beforeError = new Error('boom');
    const executorSpy = loggingExecutorFor();
    const executionResult = await runChain(
      [
        layerNamed('a'),
        {
          id: 'b',
          before: () => {
            throw beforeError;
          },
          after: () => void partLog.push('b.after'),
        },
        layerNamed('c'),
      ],
      executorSpy,
    );
    expect(executionResult).toEqual({ kind: 'raised', thrown: beforeError });
    expect(partLog).toEqual(['a.before']);
    expect(executorSpy).not.toHaveBeenCalled();
  });

  it.each([
    ['a string', 'nope'],
    ['a number', 7],
    ['nothing', undefined],
    ['null', null],
    ['a plain object', { reason: 'x' }],
  ])('reports %s raised as it was raised', async (_label, thrownValue) => {
    const executionResult = await runChain(
      [
        {
          id: 'a',
          before: () => {
            throw thrownValue;
          },
        },
      ],
      () => undefined,
    );
    expect(executionResult).toEqual({ kind: 'raised', thrown: thrownValue });
  });

  it('reports a rejected promise as raised too', async () => {
    const beforeError = new Error('later');
    const executionResult = await runChain(
      [{ id: 'a', before: () => Promise.reject(beforeError) }],
      () => undefined,
    );
    expect(executionResult).toEqual({ kind: 'raised', thrown: beforeError });
  });
});

describe('an executor that fails', () => {
  it('runs no after part', async () => {
    const { log: partLog, layer: layerNamed } = createPartLog();
    const beforeError = new Error('executor failed');
    const executionResult = await runChain(
      [layerNamed('a'), layerNamed('b')],
      () => {
        throw beforeError;
      },
    );
    expect(executionResult).toEqual({ kind: 'raised', thrown: beforeError });
    expect(partLog).toEqual(['a.before', 'b.before']);
  });
});

describe('an after part that fails', () => {
  it('leaves what the executor returned standing, and still runs the rest', async () => {
    const { log: partLog, layer: layerNamed } = createPartLog();
    const executionResult = await runChain(
      [
        layerNamed('a'),
        {
          id: 'b',
          after: () => {
            throw new Error('after failed');
          },
        },
        layerNamed('c'),
      ],
      () => [initEvent],
    );
    expect(executionResult).toEqual({
      kind: 'returned',
      emission: [initEvent],
    });
    expect(partLog).toEqual(['a.before', 'c.before', 'c.after', 'a.after']);
  });

  it('records the failure on the span, naming the layer', async () => {
    const executionTelemetry = telemetry().telemetry;
    const addEventSpy = vi.spyOn(executionTelemetry, 'addEvent');
    await runChain(
      [
        {
          id: 'noisy',
          after: () => {
            throw new Error('after failed');
          },
        },
      ],
      () => undefined,
      createArvoMiddlewareProgress(),
      executionTelemetry,
    );
    expect(addEventSpy).toHaveBeenCalledWith(
      'stage.middleware_after_failed',
      expect.objectContaining({
        'middleware.id': 'noisy',
        'error.message': 'after failed',
      }),
    );
  });

  it.each([
    ['a string', 'nope'],
    ['nothing', undefined],
    ['a rejected promise', 'rejected'],
  ])(
    'contains %s thrown from an after part',
    async (caseLabel, thrownValue) => {
      const executionResult = await runChain(
        [
          {
            id: 'a',
            after: () => {
              if (caseLabel === 'a rejected promise')
                return Promise.reject(thrownValue);
              throw thrownValue;
            },
          },
        ],
        () => [initEvent],
      );
      expect(executionResult).toEqual({
        kind: 'returned',
        emission: [initEvent],
      });
    },
  );
});

describe('what a layer returns', () => {
  it('is never read, from either part', async () => {
    const executionResult = await runChain(
      [
        {
          id: 'a',
          before: () => ['a', 'decoy'] as unknown as undefined,
          after: () => ['another', 'decoy'] as unknown as undefined,
        },
      ],
      () => [initEvent],
    );
    expect(executionResult).toEqual({
      kind: 'returned',
      emission: [initEvent],
    });
  });
});

describe('once the clock has fired', () => {
  it('runs nothing further in the before parts, and not the executor', async () => {
    const middlewareProgress = createArvoMiddlewareProgress();
    const executorSpy = vi.fn();
    const afterSpy = vi.fn();
    const pendingRun = runChain(
      [
        {
          id: 'slow',
          before: async () => {
            middlewareProgress.outran = true;
          },
        },
        { id: 'next', before: afterSpy },
      ],
      executorSpy,
      middlewareProgress,
    );
    await pendingRun;
    expect(afterSpy).not.toHaveBeenCalled();
    expect(executorSpy).not.toHaveBeenCalled();
  });

  it('runs no further after part, and records nothing for one still running', async () => {
    const middlewareProgress = createArvoMiddlewareProgress();
    const executionTelemetry = telemetry().telemetry;
    const addEventSpy = vi.spyOn(executionTelemetry, 'addEvent');
    const laterLayerSpy = vi.fn();
    await runChain(
      [
        { id: 'later', after: laterLayerSpy },
        {
          id: 'cut',
          after: () => {
            middlewareProgress.outran = true;
            throw new Error('too late to matter');
          },
        },
      ],
      () => [initEvent],
      middlewareProgress,
      executionTelemetry,
    );
    expect(laterLayerSpy).not.toHaveBeenCalled();
    expect(
      addEventSpy.mock.calls.some(
        ([name]) => name === 'stage.middleware_after_failed',
      ),
    ).toBe(false);
  });
});

describe('the marks it leaves', () => {
  it('marks each part entered and returned, by identifier', async () => {
    const executionTelemetry = telemetry().telemetry;
    const addEventSpy = vi.spyOn(executionTelemetry, 'addEvent');
    await runChain(
      [{ id: 'both', before: () => undefined, after: () => undefined }],
      () => undefined,
      createArvoMiddlewareProgress(),
      executionTelemetry,
    );
    const markNames = addEventSpy.mock.calls.map(([name, attributes]) => [
      name,
      (attributes as Record<string, unknown> | undefined)?.['middleware.id'],
    ]);
    expect(markNames).toEqual([
      ['stage.middleware_before_entered', 'both'],
      ['stage.middleware_before_returned', 'both'],
      ['stage.middleware_after_entered', 'both'],
      ['stage.middleware_after_returned', 'both'],
    ]);
  });
});

describe('resolving what was listed into layers', () => {
  const layerNamed = (layerId: string): IArvoEventHandlerMiddleware => ({
    id: layerId,
  });

  it('puts supplied layers before declared ones', async () => {
    const supplied = layerNamed('supplied');
    const declaredLayer = layerNamed('declared');
    expect(await resolveMiddleware([supplied], [declaredLayer])).toEqual([
      supplied,
      declaredLayer,
    ]);
  });

  it('is null where nothing was listed at either site', async () => {
    expect(await resolveMiddleware(null, null)).toBeNull();
  });

  it('calls a way to make one, once, and uses what it returns', async () => {
    const madeLayer = layerNamed('made');
    const makeLayer = vi.fn(() => madeLayer);
    expect(await resolveMiddleware(null, [makeLayer])).toEqual([madeLayer]);
    expect(makeLayer).toHaveBeenCalledTimes(1);
  });

  it('waits for a way to make one that is asynchronous', async () => {
    const madeLayer = layerNamed('made');
    expect(await resolveMiddleware([async () => madeLayer], null)).toEqual([
      madeLayer,
    ]);
  });

  it('makes a fresh one on every resolution', async () => {
    let madeLayer = 0;
    const makeLayer = () =>
      ({ id: `made`, n: ++madeLayer }) as IArvoEventHandlerMiddleware;
    const firstResolution = (await resolveMiddleware(null, [
      makeLayer,
    ])) as unknown[];
    const secondResolution = (await resolveMiddleware(null, [
      makeLayer,
    ])) as unknown[];
    expect(firstResolution[0]).not.toBe(secondResolution[0]);
  });

  it('refuses a way to make one that throws, naming what it threw', async () => {
    const resolution = await resolveMiddleware(null, [
      () => {
        throw new Error('no config');
      },
    ]);
    expect(resolution).toMatchObject({
      faultKind: 'middleware_instantiation_failed',
      cause: 'no config',
    });
  });

  it('refuses a way to make one that throws something other than an error, naming it', async () => {
    const resolution = await resolveMiddleware(null, [
      () => {
        throw 'no config';
      },
    ]);
    expect(resolution).toMatchObject({
      faultKind: 'middleware_instantiation_failed',
      cause: 'no config',
    });
  });

  it('refuses a way to make one that rejects', async () => {
    const resolution = await resolveMiddleware(null, [
      () => Promise.reject(new Error('later')),
    ]);
    expect(resolution).toMatchObject({
      faultKind: 'middleware_instantiation_failed',
    });
  });

  it.each([
    ['nothing', undefined],
    ['null', null],
    ['an object with no identifier', {}],
    ['an identifier that is not a string', { id: 1 }],
    ['a before part that is not callable', { id: 'x', before: 'soon' }],
  ])(
    'refuses a way to make one that returns %s',
    async (_label, thrownValue) => {
      const resolution = await resolveMiddleware(null, [
        (() => thrownValue) as unknown as ArvoEventHandlerMiddlewareEntry,
      ]);
      expect(resolution).toMatchObject({
        faultKind: 'middleware_instantiation_failed',
      });
    },
  );

  it('refuses a supplied entry that is not a layer', async () => {
    const resolution = await resolveMiddleware(
      [{ id: 3 } as unknown as IArvoEventHandlerMiddleware],
      null,
    );
    expect(resolution).toMatchObject({
      faultKind: 'middleware_instantiation_failed',
    });
  });

  it('refuses two layers with one identifier, naming it', async () => {
    const resolution = await resolveMiddleware(
      [layerNamed('same')],
      [layerNamed('same')],
    );
    expect(resolution).toMatchObject({ faultKind: 'middleware_conflict' });
    expect((resolution as { message: string }).message).toContain('same');
  });

  it('refuses a made layer whose identifier another carries', async () => {
    const resolution = await resolveMiddleware(
      [layerNamed('same')],
      [() => layerNamed('same')],
    );
    expect(resolution).toMatchObject({ faultKind: 'middleware_conflict' });
  });

  it('refuses the same instance supplied twice', async () => {
    const sameLayer = layerNamed('once');
    expect(await resolveMiddleware([sameLayer, sameLayer], null)).toMatchObject(
      {
        faultKind: 'middleware_conflict',
      },
    );
  });

  it('does not call a later way to make one once an earlier entry is refused', async () => {
    const laterLayerSpy = vi.fn(() => layerNamed('later'));
    await resolveMiddleware(
      [
        () => {
          throw new Error('first fails');
        },
      ],
      [laterLayerSpy],
    );
    expect(laterLayerSpy).not.toHaveBeenCalled();
  });
});
