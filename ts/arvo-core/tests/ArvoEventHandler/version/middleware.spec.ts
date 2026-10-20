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
const logged = () => {
  const log: string[] = [];
  const layer = (
    id: string,
    parts: { before?: boolean; after?: boolean } = {
      before: true,
      after: true,
    },
  ): IArvoEventHandlerMiddleware => ({
    id,
    ...(parts.before ? { before: () => void log.push(`${id}.before`) } : {}),
    ...(parts.after ? { after: () => void log.push(`${id}.after`) } : {}),
  });
  const executor = (returned: ArvoExecutorEmission = [initEvent]) =>
    vi.fn(() => {
      log.push('executor');
      return returned;
    });
  return { log, layer, executor };
};

const run = (
  layers: readonly IArvoEventHandlerMiddleware[] | null,
  executor: (c: ArvoExecutionContext) => unknown,
  progress: ArvoMiddlewareProgress = createArvoMiddlewareProgress(),
  traced = telemetry().telemetry,
) =>
  runMiddleware({
    layers,
    ctx,
    executor: executor as (c: ArvoExecutionContext) => ArvoExecutorEmission,
    telemetry: traced,
    progress,
  });

describe('with no layers', () => {
  it('runs the executor alone and reports what it returned', async () => {
    const { executor } = logged();
    const ran = await run(null, executor());
    expect(ran).toEqual({ kind: 'returned', returned: [initEvent] });
  });

  it('runs it exactly once', async () => {
    const { executor } = logged();
    const exec = executor();
    await run([], exec);
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it('notes when the executor started and returned', async () => {
    const progress = createArvoMiddlewareProgress();
    const { executor } = logged();
    await run(null, executor(), progress);
    expect(progress.executorStartedAt).toBeTypeOf('number');
    expect(progress.returnedAt).toBeGreaterThanOrEqual(
      progress.executorStartedAt as number,
    );
  });
});

describe('the order layers run in', () => {
  it('runs before parts in order, then the executor, then after parts in reverse', async () => {
    const { log, layer, executor } = logged();
    await run([layer('a'), layer('b'), layer('c')], executor());
    expect(log).toEqual([
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
    const { log, layer, executor } = logged();
    await run(
      [
        layer('a', { before: true }),
        layer('b', { after: true }),
        layer('c', {}),
      ],
      executor(),
    );
    expect(log).toEqual(['a.before', 'executor', 'b.after']);
  });

  it('keeps the order across many layers', async () => {
    const { log, layer, executor } = logged();
    const ids = Array.from({ length: 500 }, (_, index) => `l${index}`);
    await run(
      ids.map((id) => layer(id)),
      executor(),
    );
    expect(log).toEqual([
      ...ids.map((id) => `${id}.before`),
      'executor',
      ...[...ids].reverse().map((id) => `${id}.after`),
    ]);
  });

  it('waits for a part that is asynchronous before running the next', async () => {
    const log: string[] = [];
    const slow: IArvoEventHandlerMiddleware = {
      id: 'slow',
      before: async () => {
        await new Promise((settle) => setTimeout(settle, 5));
        log.push('slow.before');
      },
    };
    await run([slow], () => {
      log.push('executor');
    });
    expect(log).toEqual(['slow.before', 'executor']);
  });
});

describe('what each part is given', () => {
  it('gives every part the same context the executor is given', async () => {
    const seen: unknown[] = [];
    const layer: IArvoEventHandlerMiddleware = {
      id: 'seer',
      before: (c) => void seen.push(c),
      after: (c) => void seen.push(c),
    };
    await run([layer], (c) => {
      seen.push(c);
    });
    expect(seen).toEqual([ctx, ctx, ctx]);
    expect(seen.every((each) => each === ctx)).toBe(true);
  });

  it('gives an after part what the executor returned', async () => {
    let seen: unknown;
    await run(
      [
        {
          id: 'a',
          after: (_c, emission) => {
            seen = emission;
          },
        },
      ],
      () => [initEvent],
    );
    expect(seen).toEqual([initEvent]);
  });

  it('gives an after part a list nothing can change', async () => {
    let attempt: unknown;
    const ran = await run(
      [
        {
          id: 'a',
          after: (_c, emission) => {
            try {
              (emission as unknown[]).push('extra');
            } catch (raised) {
              attempt = raised;
            }
          },
        },
      ],
      () => [initEvent],
    );
    expect(attempt).toBeInstanceOf(TypeError);
    expect(ran).toEqual({ kind: 'returned', returned: [initEvent] });
  });

  it('gives an after part nothing where the executor returned nothing', async () => {
    let seen: unknown = 'unset';
    await run(
      [
        {
          id: 'a',
          after: (_c, emission) => {
            seen = emission;
          },
        },
      ],
      () => undefined,
    );
    expect(seen).toBeUndefined();
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
    const counter = new Counter();
    await run([counter], () => undefined);
    expect(counter.calls).toBe(2);
  });
});

describe('a before part that fails', () => {
  it('stops everything after it and reports what it raised', async () => {
    const { log, layer, executor } = logged();
    const boom = new Error('boom');
    const exec = executor();
    const ran = await run(
      [
        layer('a'),
        {
          id: 'b',
          before: () => {
            throw boom;
          },
          after: () => void log.push('b.after'),
        },
        layer('c'),
      ],
      exec,
    );
    expect(ran).toEqual({ kind: 'raised', raised: boom });
    expect(log).toEqual(['a.before']);
    expect(exec).not.toHaveBeenCalled();
  });

  it.each([
    ['a string', 'nope'],
    ['a number', 7],
    ['nothing', undefined],
    ['null', null],
    ['a plain object', { reason: 'x' }],
  ])('reports %s raised as it was raised', async (_label, value) => {
    const ran = await run(
      [
        {
          id: 'a',
          before: () => {
            throw value;
          },
        },
      ],
      () => undefined,
    );
    expect(ran).toEqual({ kind: 'raised', raised: value });
  });

  it('reports a rejected promise as raised too', async () => {
    const boom = new Error('later');
    const ran = await run(
      [{ id: 'a', before: () => Promise.reject(boom) }],
      () => undefined,
    );
    expect(ran).toEqual({ kind: 'raised', raised: boom });
  });
});

describe('an executor that fails', () => {
  it('runs no after part', async () => {
    const { log, layer } = logged();
    const boom = new Error('executor failed');
    const ran = await run([layer('a'), layer('b')], () => {
      throw boom;
    });
    expect(ran).toEqual({ kind: 'raised', raised: boom });
    expect(log).toEqual(['a.before', 'b.before']);
  });
});

describe('an after part that fails', () => {
  it('leaves what the executor returned standing, and still runs the rest', async () => {
    const { log, layer } = logged();
    const ran = await run(
      [
        layer('a'),
        {
          id: 'b',
          after: () => {
            throw new Error('after failed');
          },
        },
        layer('c'),
      ],
      () => [initEvent],
    );
    expect(ran).toEqual({ kind: 'returned', returned: [initEvent] });
    expect(log).toEqual(['a.before', 'c.before', 'c.after', 'a.after']);
  });

  it('records the failure on the span, naming the layer', async () => {
    const traced = telemetry().telemetry;
    const marked = vi.spyOn(traced, 'addEvent');
    await run(
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
      traced,
    );
    expect(marked).toHaveBeenCalledWith(
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
  ])('contains %s thrown from an after part', async (label, value) => {
    const ran = await run(
      [
        {
          id: 'a',
          after: () => {
            if (label === 'a rejected promise') return Promise.reject(value);
            throw value;
          },
        },
      ],
      () => [initEvent],
    );
    expect(ran).toEqual({ kind: 'returned', returned: [initEvent] });
  });
});

describe('what a layer returns', () => {
  it('is never read, from either part', async () => {
    const ran = await run(
      [
        {
          id: 'a',
          before: () => ['a', 'decoy'] as unknown as undefined,
          after: () => ['another', 'decoy'] as unknown as undefined,
        },
      ],
      () => [initEvent],
    );
    expect(ran).toEqual({ kind: 'returned', returned: [initEvent] });
  });
});

describe('once the clock has fired', () => {
  it('runs nothing further in the before parts, and not the executor', async () => {
    const progress = createArvoMiddlewareProgress();
    const exec = vi.fn();
    const after = vi.fn();
    const pending = run(
      [
        {
          id: 'slow',
          before: async () => {
            progress.abandoned = true;
          },
        },
        { id: 'next', before: after },
      ],
      exec,
      progress,
    );
    await pending;
    expect(after).not.toHaveBeenCalled();
    expect(exec).not.toHaveBeenCalled();
  });

  it('runs no further after part, and records nothing for one still running', async () => {
    const progress = createArvoMiddlewareProgress();
    const traced = telemetry().telemetry;
    const marked = vi.spyOn(traced, 'addEvent');
    const later = vi.fn();
    await run(
      [
        { id: 'later', after: later },
        {
          id: 'cut',
          after: () => {
            progress.abandoned = true;
            throw new Error('too late to matter');
          },
        },
      ],
      () => [initEvent],
      progress,
      traced,
    );
    expect(later).not.toHaveBeenCalled();
    expect(
      marked.mock.calls.some(
        ([name]) => name === 'stage.middleware_after_failed',
      ),
    ).toBe(false);
  });
});

describe('the marks it leaves', () => {
  it('marks each part entered and returned, by identifier', async () => {
    const traced = telemetry().telemetry;
    const marked = vi.spyOn(traced, 'addEvent');
    await run(
      [{ id: 'both', before: () => undefined, after: () => undefined }],
      () => undefined,
      createArvoMiddlewareProgress(),
      traced,
    );
    const names = marked.mock.calls.map(([name, attributes]) => [
      name,
      (attributes as Record<string, unknown> | undefined)?.['middleware.id'],
    ]);
    expect(names).toEqual([
      ['stage.middleware_before_entered', 'both'],
      ['stage.middleware_before_returned', 'both'],
      ['stage.middleware_after_entered', 'both'],
      ['stage.middleware_after_returned', 'both'],
    ]);
  });
});

describe('resolving what was listed into layers', () => {
  const layer = (id: string): IArvoEventHandlerMiddleware => ({ id });

  it('puts supplied layers before declared ones', async () => {
    const supplied = layer('supplied');
    const declared = layer('declared');
    expect(await resolveMiddleware([supplied], [declared])).toEqual([
      supplied,
      declared,
    ]);
  });

  it('is null where nothing was listed at either site', async () => {
    expect(await resolveMiddleware(null, null)).toBeNull();
  });

  it('calls a way to make one, once, and uses what it returns', async () => {
    const made = layer('made');
    const make = vi.fn(() => made);
    expect(await resolveMiddleware(null, [make])).toEqual([made]);
    expect(make).toHaveBeenCalledTimes(1);
  });

  it('waits for a way to make one that is asynchronous', async () => {
    const made = layer('made');
    expect(await resolveMiddleware([async () => made], null)).toEqual([made]);
  });

  it('makes a fresh one on every resolution', async () => {
    let made = 0;
    const make = () =>
      ({ id: `made`, n: ++made }) as IArvoEventHandlerMiddleware;
    const first = (await resolveMiddleware(null, [make])) as unknown[];
    const second = (await resolveMiddleware(null, [make])) as unknown[];
    expect(first[0]).not.toBe(second[0]);
  });

  it('refuses a way to make one that throws, naming what it threw', async () => {
    const resolved = await resolveMiddleware(null, [
      () => {
        throw new Error('no config');
      },
    ]);
    expect(resolved).toMatchObject({
      faultKind: 'middleware_instantiation_failed',
      cause: 'no config',
    });
  });

  it('refuses a way to make one that throws something other than an error, naming it', async () => {
    const resolved = await resolveMiddleware(null, [
      () => {
        throw 'no config';
      },
    ]);
    expect(resolved).toMatchObject({
      faultKind: 'middleware_instantiation_failed',
      cause: 'no config',
    });
  });

  it('refuses a way to make one that rejects', async () => {
    const resolved = await resolveMiddleware(null, [
      () => Promise.reject(new Error('later')),
    ]);
    expect(resolved).toMatchObject({
      faultKind: 'middleware_instantiation_failed',
    });
  });

  it.each([
    ['nothing', undefined],
    ['null', null],
    ['an object with no identifier', {}],
    ['an identifier that is not a string', { id: 1 }],
    ['a before part that is not callable', { id: 'x', before: 'soon' }],
  ])('refuses a way to make one that returns %s', async (_label, value) => {
    const resolved = await resolveMiddleware(null, [
      (() => value) as unknown as ArvoEventHandlerMiddlewareEntry,
    ]);
    expect(resolved).toMatchObject({
      faultKind: 'middleware_instantiation_failed',
    });
  });

  it('refuses a supplied entry that is not a layer', async () => {
    const resolved = await resolveMiddleware(
      [{ id: 3 } as unknown as IArvoEventHandlerMiddleware],
      null,
    );
    expect(resolved).toMatchObject({
      faultKind: 'middleware_instantiation_failed',
    });
  });

  it('refuses two layers with one identifier, naming it', async () => {
    const resolved = await resolveMiddleware([layer('same')], [layer('same')]);
    expect(resolved).toMatchObject({ faultKind: 'middleware_conflict' });
    expect((resolved as { message: string }).message).toContain('same');
  });

  it('refuses a made layer whose identifier another carries', async () => {
    const resolved = await resolveMiddleware(
      [layer('same')],
      [() => layer('same')],
    );
    expect(resolved).toMatchObject({ faultKind: 'middleware_conflict' });
  });

  it('refuses the same instance supplied twice', async () => {
    const once = layer('once');
    expect(await resolveMiddleware([once, once], null)).toMatchObject({
      faultKind: 'middleware_conflict',
    });
  });

  it('does not call a later way to make one once an earlier entry is refused', async () => {
    const later = vi.fn(() => layer('later'));
    await resolveMiddleware(
      [
        () => {
          throw new Error('first fails');
        },
      ],
      [later],
    );
    expect(later).not.toHaveBeenCalled();
  });
});
