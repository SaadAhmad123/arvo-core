import { describe, expect, it, vi } from 'vitest';
import type { ArvoEvent } from '../../../src/ArvoEvent/index.js';
import type { IArvoEventHandlerMiddleware } from '../../../src/ArvoEventHandler/types/middleware.js';
import { openOne, orderHandler, recordingSpan, sleep } from './fixture.js';

/**
 * After parts that misbehave, every way one can.
 *
 * The rule under test is one sentence: once the executor has returned,
 * nothing an after part does changes what the execution produces.
 */

/** What an execution produced, or a failure to say why it did not. */
const produced = async (middleware: IArvoEventHandlerMiddleware[]) => {
  const probe = recordingSpan();
  const ran = await openOne(orderHandler({ tracer: probe.tracer, middleware }));
  if (!ran.ok || ran.value.kind !== 'produced') {
    throw new Error(`expected produced, got ${JSON.stringify(ran)}`);
  }
  return { ...ran.value, probe };
};

/** What an untouched execution produces, to compare against. */
const baseline = async () => produced([]);

describe('an after part that throws', () => {
  it.each([
    ['an error', new Error('boom')],
    ['a string', 'boom'],
    ['a number', 7],
    ['null', null],
    ['undefined', undefined],
    ['a plain object', { reason: 'boom' }],
    ['a frozen object', Object.freeze({ reason: 'boom' })],
  ])(
    'leaves the outcome as it was, having thrown %s',
    async (_label, value) => {
      const { state, events } = await produced([
        {
          id: 'thrower',
          after: () => {
            throw value;
          },
        },
      ]);
      expect(state.lifecycle).toBe('success');
      expect(events.map((event) => event.type)).toEqual(['com_order_created']);
    },
  );

  it('leaves the outcome as it was where it rejects', async () => {
    const { state } = await produced([
      { id: 'rejecter', after: () => Promise.reject(new Error('later')) },
    ]);
    expect(state.lifecycle).toBe('success');
  });

  it('leaves the outcome as it was where it raises a fault through the context', async () => {
    const { state, probe } = await produced([
      {
        id: 'faulter',
        after: async (ctx) => {
          throw await ctx.fault({
            faultKind: 'executor_raised',
            message: 'late',
            retryable: false,
          });
        },
      },
    ]);
    expect(state.lifecycle).toBe('success');
    expect(probe.marks()).toContainEqual([
      'middleware_after_failed',
      'faulter',
    ]);
  });

  it('names what was thrown on the span', async () => {
    const { probe } = await produced([
      {
        id: 'thrower',
        after: () => {
          throw new RangeError('out of range');
        },
      },
    ]);
    const mark = probe.events.find((each) =>
      each.name.endsWith('middleware_after_failed'),
    );
    expect(mark?.attributes).toMatchObject({
      'middleware.id': 'thrower',
      'error.name': 'RangeError',
      'error.message': 'out of range',
    });
  });

  it('still lets every other after part run', async () => {
    const ran: string[] = [];
    await produced([
      { id: 'outer', after: () => void ran.push('outer') },
      {
        id: 'thrower',
        after: () => {
          throw new Error('boom');
        },
      },
      { id: 'inner', after: () => void ran.push('inner') },
    ]);
    expect(ran).toEqual(['inner', 'outer']);
  });
});

describe('an after part that tries to change what was returned', () => {
  it('cannot add to the list', async () => {
    let failure: unknown;
    const { events } = await produced([
      {
        id: 'adder',
        after: (_ctx, emission) => {
          try {
            (emission as ArvoEvent[]).push(null as never);
          } catch (raised) {
            failure = raised;
          }
        },
      },
    ]);
    expect(failure).toBeInstanceOf(TypeError);
    expect(events).toHaveLength(1);
  });

  it('cannot empty the list', async () => {
    const { events } = await produced([
      {
        id: 'emptier',
        after: (_ctx, emission) => {
          (emission as ArvoEvent[]).length = 0;
        },
      },
    ]);
    expect(events).toHaveLength(1);
  });

  it('cannot change an event in it', async () => {
    let failure: unknown;
    const { events } = await produced([
      {
        id: 'editor',
        after: (_ctx, emission) => {
          try {
            (
              (emission as ArvoEvent[])[0] as unknown as Record<string, unknown>
            ).to = 'somewhere_else';
          } catch (raised) {
            failure = raised;
          }
        },
      },
    ]);
    expect(failure).toBeInstanceOf(TypeError);
    expect(events[0]?.to).not.toBe('somewhere_else');
  });

  it.each([
    ['an event of its own', (ctx: never) => (ctx as { state: unknown }).state],
    ['a promise of events', () => Promise.resolve([])],
    ['false', () => false],
  ])('is ignored where it returns %s', async (_label, returned) => {
    const base = await baseline();
    const { events } = await produced([
      { id: 'returner', after: returned as never },
    ]);
    expect(events.map((event) => event.type)).toEqual(
      base.events.map((event) => event.type),
    );
  });
});

describe('an after part that writes through the context', () => {
  it('cannot change what is remembered: the record is the one the executor returned with', async () => {
    const { state, probe } = await produced([
      {
        id: 'late_writer',
        after: async (ctx) => {
          await (
            ctx as never as {
              setState: (param: unknown) => Promise<void>;
            }
          ).setState({ data: { stage: 'rewritten-afterwards' } });
        },
      },
    ]);
    expect((state.data as { stage: string }).stage).toBe('answered');
    expect(
      probe.events.some((each) =>
        each.name.endsWith('middleware_after_write_discarded'),
      ),
    ).toBe(true);
  });

  it('cannot cancel an execution the executor has already concluded', async () => {
    const { state } = await produced([
      {
        id: 'late_canceller',
        after: (ctx) => {
          (ctx as never as { cancel: (reason: string) => void }).cancel(
            'too late',
          );
        },
      },
    ]);
    expect(state.lifecycle).toBe('success');
  });

  it('may write middleware data, which nothing reads by then', async () => {
    const { state } = await produced([
      { id: 'scribbler', after: (ctx) => ctx.setMiddleware('late', true) },
    ]);
    expect(state.lifecycle).toBe('success');
  });

  it('marks nothing discarded where it wrote nothing', async () => {
    const { probe } = await produced([{ id: 'quiet', after: () => undefined }]);
    expect(
      probe.events.some((each) =>
        each.name.endsWith('middleware_after_write_discarded'),
      ),
    ).toBe(false);
  });
});

describe('an after part that never finishes', () => {
  it('is cut by the run clock, the outcome standing and the rest skipped', async () => {
    const later = vi.fn();
    const probe = recordingSpan();
    const ran = await openOne(
      orderHandler({
        runTimeout: 25,
        tracer: probe.tracer,
        middleware: [
          { id: 'later', after: later },
          { id: 'forever', after: () => new Promise<void>(() => undefined) },
        ],
      }),
    );
    expect(
      ran.ok && ran.value.kind === 'produced' && ran.value.state.lifecycle,
    ).toBe('success');
    expect(later).not.toHaveBeenCalled();
    expect(
      probe.events.some((each) => each.name.endsWith('middleware_after_cut')),
    ).toBe(true);
  });

  it('records nothing for what it does once it has been cut', async () => {
    const probe = recordingSpan();
    await openOne(
      orderHandler({
        runTimeout: 20,
        tracer: probe.tracer,
        middleware: [
          {
            id: 'straggler',
            after: async () => {
              await sleep(60);
              throw new Error('far too late');
            },
          },
        ],
      }),
    );
    await sleep(80);
    expect(probe.marks()).not.toContainEqual([
      'middleware_after_failed',
      'straggler',
    ]);
  });
});
