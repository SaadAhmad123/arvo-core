import { describe, expect, it, vi } from 'vitest';
import type { IArvoEventHandlerMiddleware } from '../../../src/ArvoEventHandler/types/middleware.js';
import { orderVersion } from '../fixtures.js';
import {
  anOrder,
  answering,
  logging,
  openOne,
  orderHandler,
  recordingSpan,
  sleep,
  storing,
} from './fixture.js';

/**
 * Layers through the handler, end to end: declared, supplied, made per
 * execution, and timed.
 */

const layer = (id: string): IArvoEventHandlerMiddleware => ({ id });

describe('an execution with no layers anywhere', () => {
  it('produces exactly what it produced before layers existed', async () => {
    const ran = await openOne(orderHandler());
    expect(ran.ok && ran.value.kind).toBe('produced');
    expect(
      ran.ok && ran.value.kind === 'produced' && ran.value.events[0]?.type,
    ).toBe('com_order_created');
  });

  it('is the same with an empty list supplied', async () => {
    const ran = await openOne(orderHandler(), { middleware: [] });
    expect(ran.ok && ran.value.kind).toBe('produced');
  });

  it('marks no layer on the span', async () => {
    const probe = recordingSpan();
    await openOne(orderHandler({ tracer: probe.tracer }));
    expect(probe.marks()).toEqual([]);
  });
});

describe('the order layers run in, through the handler', () => {
  it('runs supplied before declared, then the executor, then the reverse', async () => {
    const { log, layer: logged, execute } = logging();
    const handler = orderHandler({
      execute,
      middleware: [logged('declared_1'), logged('declared_2')],
    });
    await openOne(handler, {
      middleware: [logged('supplied_1'), logged('supplied_2')],
    });
    expect(log).toEqual([
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
    const { log, layer: logged, execute } = logging();
    const handler = orderHandler({ execute, middleware: [logged('declared')] });
    await openOne(handler, {
      middleware: [logged('supplied')],
      event: anOrder('a'),
    });
    await openOne(handler, { event: anOrder('b') });
    expect(log.filter((line) => line.startsWith('supplied'))).toHaveLength(2);
    expect(log.filter((line) => line.startsWith('declared'))).toHaveLength(4);
  });
});

describe('what a before part can do to what the executor sees', () => {
  it('writes state the executor reads', async () => {
    let seen: unknown;
    const handler = orderHandler({
      middleware: [
        {
          id: 'stager',
          before: async (ctx) => {
            await (
              ctx as never as { setState: (p: unknown) => Promise<void> }
            ).setState({
              data: { stage: 'set-by-layer' },
            });
          },
        },
      ],
      execute: async (ctx) => {
        seen = ctx.state.data?.stage;
        return answering(ctx);
      },
    });
    await openOne(handler);
    expect(seen).toBe('set-by-layer');
  });

  it('leaves middleware data the executor reads', async () => {
    let seen: unknown;
    const handler = orderHandler({
      middleware: [
        { id: 'tenant', before: (ctx) => ctx.setMiddleware('tenant', 't-1') },
      ],
      execute: async (ctx) => {
        seen = ctx.middleware.tenant;
        return answering(ctx);
      },
    });
    await openOne(handler);
    expect(seen).toBe('t-1');
  });

  it('leaves middleware data an inner layer reads', async () => {
    let seen: unknown;
    const handler = orderHandler({
      middleware: [
        {
          id: 'inner',
          before: (ctx) => {
            seen = ctx.middleware.from_outside;
          },
        },
      ],
    });
    await openOne(handler, {
      middleware: [
        { id: 'outer', before: (ctx) => ctx.setMiddleware('from_outside', 42) },
      ],
    });
    expect(seen).toBe(42);
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
    const ran = await openOne(handler);
    expect(
      JSON.stringify(
        ran.ok && ran.value.kind === 'produced' && ran.value.state,
      ),
    ).not.toContain('not-in-the-record');
  });
});

describe('a before part that fails, through the handler', () => {
  it('becomes the handler error event where it throws', async () => {
    const execute = vi.fn(answering);
    const handler = orderHandler({
      execute,
      middleware: [
        {
          id: 'broken',
          before: () => {
            throw new Error('layer broke');
          },
        },
      ],
    });
    const ran = await openOne(handler);
    expect(ran.ok).toBe(true);
    const produced = ran.ok && ran.value.kind === 'produced' ? ran.value : null;
    expect(produced?.events[0]?.type).toBe(orderVersion.error.type);
    expect(produced?.state.lifecycle).toBe('error');
    expect(execute).not.toHaveBeenCalled();
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
    const ran = await openOne(handler);
    expect(ran.ok).toBe(false);
    expect(!ran.ok && ran.error.faultKind).toBe('executor_raised');
    expect(!ran.ok && ran.error.retry).toBeNull();
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
    const ran = await openOne(handler);
    expect(!ran.ok && ran.error.retry).not.toBeNull();
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
    const ran = await openOne(handler);
    expect(
      ran.ok && ran.value.kind === 'produced' && ran.value.state.lifecycle,
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
    const ran = await openOne(handler);
    expect(ran.ok).toBe(true);
  });

  it('marks the failure on the span', async () => {
    const probe = recordingSpan();
    const handler = orderHandler({
      tracer: probe.tracer,
      middleware: [
        {
          id: 'noisy',
          after: () => {
            throw new Error('after broke');
          },
        },
      ],
    });
    await openOne(handler);
    expect(probe.marks()).toContainEqual(['middleware_after_failed', 'noisy']);
  });

  it('does not run where the executor threw', async () => {
    const after = vi.fn();
    const handler = orderHandler({
      middleware: [{ id: 'watcher', after }],
      execute: () => {
        throw new Error('executor broke');
      },
    });
    await openOne(handler);
    expect(after).not.toHaveBeenCalled();
  });

  it('sees a return that validation then refuses, and changes nothing about it', async () => {
    let seen: unknown;
    const handler = orderHandler({
      middleware: [
        {
          id: 'watcher',
          after: (_ctx, emission) => {
            seen = emission;
          },
        },
      ],
      execute: () => 'not an event' as never,
    });
    const ran = await openOne(handler);
    expect(seen).toBe('not an event');
    expect(!ran.ok && ran.error.faultKind).toBe('emission_not_permitted');
  });
});

describe('supplied identifiers', () => {
  it('refuses one a declared layer already carries, before anything runs', async () => {
    const execute = vi.fn(answering);
    const before = vi.fn();
    const handler = orderHandler({
      execute,
      middleware: [{ id: 'same', before }],
    });
    const ran = await openOne(handler, { middleware: [layer('same')] });
    expect(!ran.ok && ran.error.faultKind).toBe('middleware_conflict');
    expect(!ran.ok && ran.error.retry).toBeNull();
    expect(!ran.ok && ran.error.message).toContain('same');
    expect(before).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it('refuses two supplied layers with one identifier', async () => {
    const ran = await openOne(orderHandler(), {
      middleware: [layer('twice'), layer('twice')],
    });
    expect(!ran.ok && ran.error.faultKind).toBe('middleware_conflict');
  });

  it('carries the pair a mechanism would abandon with', async () => {
    const ran = await openOne(orderHandler(), {
      middleware: [layer('twice'), layer('twice')],
    });
    expect(!ran.ok && ran.error.abandonmentEvent).not.toBeNull();
  });
});

describe('a way to make a layer', () => {
  it('is called once for each execution, declared', async () => {
    const make = vi.fn(() => layer('made'));
    const handler = orderHandler({ middleware: [make] });
    await openOne(handler, { event: anOrder('a') });
    await openOne(handler, { event: anOrder('b') });
    expect(make).toHaveBeenCalledTimes(2);
  });

  it('is called once for the execution it was supplied to', async () => {
    const make = vi.fn(() => layer('made'));
    await openOne(orderHandler(), { middleware: [make] });
    expect(make).toHaveBeenCalledTimes(1);
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
    await openOne(handler, { event: anOrder('a') });
    await openOne(handler, { event: anOrder('b') });
    expect(instances).toHaveLength(2);
    expect(instances[0]).not.toBe(instances[1]);
    expect((instances as Stopwatch[]).every((each) => each.took >= 0)).toBe(
      true,
    );
  });

  it('may be asynchronous', async () => {
    const before = vi.fn();
    await openOne(orderHandler(), {
      middleware: [async () => ({ id: 'async', before })],
    });
    expect(before).toHaveBeenCalledTimes(1);
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
    async (_label, make) => {
      const execute = vi.fn(answering);
      const ran = await openOne(orderHandler({ execute }), {
        middleware: [make as never],
      });
      expect(!ran.ok && ran.error.faultKind).toBe(
        'middleware_instantiation_failed',
      );
      expect(!ran.ok && ran.error.retry).toBeNull();
      expect(execute).not.toHaveBeenCalled();
    },
  );

  it('is refused where what it makes repeats an identifier', async () => {
    const ran = await openOne(orderHandler({ middleware: [layer('same')] }), {
      middleware: [() => layer('same')],
    });
    expect(!ran.ok && ran.error.faultKind).toBe('middleware_conflict');
  });
});

describe('the run clock over the layers', () => {
  it('runs out in a slow before part as a run timeout, the executor never entered', async () => {
    const execute = vi.fn(answering);
    const handler = orderHandler({
      runTimeout: 20,
      execute,
      middleware: [{ id: 'slow', before: () => sleep(80) }],
    });
    const ran = await openOne(handler);
    expect(!ran.ok && ran.error.faultKind).toBe('run_timeout');
    await sleep(80);
    expect(execute).not.toHaveBeenCalled();
  });

  it('runs out in a slow after part with the executor return standing', async () => {
    const probe = recordingSpan();
    const later = vi.fn();
    const handler = orderHandler({
      runTimeout: 30,
      tracer: probe.tracer,
      middleware: [
        { id: 'later', after: later },
        { id: 'slow', after: () => sleep(120) },
      ],
    });
    const ran = await openOne(handler);
    expect(
      ran.ok && ran.value.kind === 'produced' && ran.value.state.lifecycle,
    ).toBe('success');
    await sleep(150);
    expect(later).not.toHaveBeenCalled();
    expect(
      probe.events.some((each) => each.name.endsWith('middleware_after_cut')),
    ).toBe(true);
  });

  it('does not refuse for time an execution whose after part ran past the execution clock', async () => {
    const handler = orderHandler({
      runTimeout: 60,
      executionTimeout: 60,
      middleware: [{ id: 'slow', after: () => sleep(120) }],
    });
    const ran = await openOne(handler, { event: anOrder() });
    expect(ran.ok).toBe(true);
  });

  it('cuts nothing where the run clock is unbounded', async () => {
    const after = vi.fn();
    const handler = orderHandler({
      runTimeout: null,
      executionTimeout: null,
      middleware: [
        { id: 'checked', after },
        { id: 'slow', after: () => sleep(40) },
      ],
    });
    await openOne(handler);
    expect(after).toHaveBeenCalledTimes(1);
  });
});

describe('where layers do not run', () => {
  it('runs none where the gate refuses the event', async () => {
    const before = vi.fn();
    const store = storing();
    const handler = orderHandler({ middleware: [{ id: 'watch', before }] });
    const order = anOrder();

    const first = await openOne(handler, { store, event: order });
    if (first.ok && first.value.kind === 'produced')
      store.commit(first.value.state);
    expect(before).toHaveBeenCalledTimes(1);

    // the same opening event again: an execution exists, so the gate refuses it
    const repeat = await openOne(handler, { store, event: order });
    expect(!repeat.ok && repeat.error.faultKind).toBe('record_unexpected');
    expect(before).toHaveBeenCalledTimes(1);
  });
});

describe('the span', () => {
  it('is one span however many layers there are', async () => {
    const probe = recordingSpan();
    const many = Array.from({ length: 50 }, (_, index) => ({
      id: `l${index}`,
      before: () => undefined,
      after: () => undefined,
    }));
    await openOne(orderHandler({ tracer: probe.tracer, middleware: many }));
    expect(probe.started()).toBe(1);
  });

  it('marks each part entered and returned, by identifier, in order', async () => {
    const probe = recordingSpan();
    await openOne(
      orderHandler({
        tracer: probe.tracer,
        middleware: [
          { id: 'declared', before: () => undefined, after: () => undefined },
        ],
      }),
      { middleware: [{ id: 'supplied', before: () => undefined }] },
    );
    expect(probe.marks()).toEqual([
      ['middleware_before_entered', 'supplied'],
      ['middleware_before_returned', 'supplied'],
      ['middleware_before_entered', 'declared'],
      ['middleware_before_returned', 'declared'],
      ['middleware_after_entered', 'declared'],
      ['middleware_after_returned', 'declared'],
    ]);
  });
});
