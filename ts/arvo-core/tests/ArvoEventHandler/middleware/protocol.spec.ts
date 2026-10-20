import { describe, expect, it, vi } from 'vitest';
import type { JSONObject } from '../../../src/types.js';
import {
  failingToClose,
  heldDependencies,
  openedPerExecution,
} from '../dependency.js';
import {
  anOrder,
  answering,
  answerTo,
  askingTwice,
  openOne,
  orderHandler,
  storing,
} from './fixture.js';

/**
 * The protocol around the chain, untouched by it.
 *
 * Layers that only read must leave an execution indistinguishable from
 * one with none, and the places the protocol says the executor is not
 * entered must enter no layer either.
 */

const readOnly = () => ({
  id: 'reader',
  before: (ctx: { state: unknown }) => void ctx.state,
  after: () => undefined,
});

/** The parts of a record that do not depend on fresh ids or clocks. */
const shapeOf = (record: JSONObject) => ({
  executionId: record.executionId,
  subject: record.subject,
  casVersion: record.casVersion,
  lifecycle: record.lifecycle,
  depth: record.depth,
  version: record.version,
  data: record.data,
  directions: (record.eventIds as { direction: string }[]).map(
    (each) => each.direction,
  ),
  awaiting: Object.keys(record.inFlightEventMap as object).length,
});

describe('an execution whose layers only read', () => {
  it('produces a record of the same shape as one with no layers', async () => {
    const order = anOrder();
    const bare = await openOne(orderHandler(), { event: order });
    const layered = await openOne(
      orderHandler({ middleware: [readOnly() as never] }),
      {
        event: order,
      },
    );
    const a =
      bare.ok && bare.value.kind === 'produced' ? bare.value.state : null;
    const b =
      layered.ok && layered.value.kind === 'produced'
        ? layered.value.state
        : null;
    expect(shapeOf(b as JSONObject)).toEqual(shapeOf(a as JSONObject));
  });

  it('hands the executor the same idempotency keys', async () => {
    const order = anOrder();
    const keys: unknown[] = [];
    const recordKeys = async (ctx: Parameters<typeof answering>[0]) => {
      keys.push(ctx.idempotency);
      return answering(ctx);
    };
    await openOne(orderHandler({ execute: recordKeys }), { event: order });
    await openOne(
      orderHandler({ execute: recordKeys, middleware: [readOnly() as never] }),
      {
        event: order,
      },
    );
    expect(keys[1]).toEqual(keys[0]);
  });

  it('asks the same services and waits on the same number of answers', async () => {
    const order = anOrder();
    const bare = await openOne(orderHandler({ execute: askingTwice }), {
      event: order,
    });
    const layered = await openOne(
      orderHandler({ execute: askingTwice, middleware: [readOnly() as never] }),
      { event: order },
    );
    const a = bare.ok && bare.value.kind === 'produced' ? bare.value : null;
    const b =
      layered.ok && layered.value.kind === 'produced' ? layered.value : null;
    expect(b?.events.map((e) => e.type)).toEqual(a?.events.map((e) => e.type));
    expect(shapeOf(b?.state as JSONObject)).toEqual(
      shapeOf(a?.state as JSONObject),
    );
  });
});

describe('where the executor is not entered, no layer is', () => {
  it('enters none on a partial collection under the default join', async () => {
    const store = storing();
    const before = vi.fn();
    const handler = orderHandler({
      execute: askingTwice,
      middleware: [{ id: 'w', before }],
    });
    const order = anOrder();
    const asked = await openOne(handler, { store, event: order });
    if (!asked.ok || asked.value.kind !== 'produced')
      throw new Error('nothing asked');
    store.commit(asked.value.state);
    before.mockClear();

    const firstAnswer = answerTo(
      asked.value.events[0] as { id: string; subject: string },
      asked.value.state.executionId as string,
    );
    const partial = await openOne(handler, {
      store,
      event: firstAnswer as never,
    });
    expect(partial.ok && partial.value.kind).toBe('produced');
    expect(before).not.toHaveBeenCalled();
  });

  it('enters them once the collection completes', async () => {
    const store = storing();
    const before = vi.fn();
    const handler = orderHandler({
      execute: askingTwice,
      middleware: [{ id: 'w', before }],
    });
    const asked = await openOne(handler, { store, event: anOrder() });
    if (!asked.ok || asked.value.kind !== 'produced')
      throw new Error('nothing asked');
    store.commit(asked.value.state);
    const executionId = asked.value.state.executionId as string;
    const [one, two] = asked.value.events as unknown as [
      { id: string; subject: string },
      { id: string; subject: string },
    ];

    const partial = await openOne(handler, {
      store,
      event: answerTo(one, executionId) as never,
    });
    if (partial.ok && partial.value.kind === 'produced')
      store.commit(partial.value.state);
    before.mockClear();
    const complete = await openOne(handler, {
      store,
      event: answerTo(two, executionId) as never,
    });
    expect(
      complete.ok &&
        complete.value.kind === 'produced' &&
        complete.value.state.lifecycle,
    ).toBe('success');
    expect(before).toHaveBeenCalledTimes(1);
  });

  it('enters none for an answer already taken in', async () => {
    const store = storing();
    const before = vi.fn();
    const handler = orderHandler({
      execute: askingTwice,
      middleware: [{ id: 'w', before }],
    });
    const asked = await openOne(handler, { store, event: anOrder() });
    if (!asked.ok || asked.value.kind !== 'produced')
      throw new Error('nothing asked');
    store.commit(asked.value.state);
    const answer = answerTo(
      asked.value.events[0] as { id: string; subject: string },
      asked.value.state.executionId as string,
    );
    const once = await openOne(handler, { store, event: answer as never });
    if (once.ok && once.value.kind === 'produced')
      store.commit(once.value.state);
    before.mockClear();
    const twice = await openOne(handler, { store, event: answer as never });
    expect(twice.ok && twice.value.kind).toBe('discarded');
    expect(before).not.toHaveBeenCalled();
  });

  it('enters none where the dependency would not open', async () => {
    const before = vi.fn();
    const ran = await openOne(
      orderHandler({ middleware: [{ id: 'w', before }] }),
      {
        dependencies: {
          open: () => {
            throw new Error('pool exhausted');
          },
          close: () => undefined,
          attributes: {},
        },
      },
    );
    expect(!ran.ok && ran.error.faultKind).toBe('dependency_resolution_failed');
    expect(before).not.toHaveBeenCalled();
  });
});

describe('the dependency around a failing chain', () => {
  it('is still closed after a before part throws', async () => {
    const watched = openedPerExecution(() => ({ db: 'connection' }));
    await openOne(
      orderHandler({
        middleware: [
          {
            id: 'broken',
            before: () => {
              throw new Error('boom');
            },
          },
        ],
      }),
      { dependencies: watched.dependency },
    );
    expect(watched.calls.opened).toHaveLength(1);
    expect(watched.calls.closed).toHaveLength(1);
  });

  it('is still closed after a before part faults', async () => {
    const watched = heldDependencies({ db: 'connection' });
    await openOne(
      orderHandler({
        middleware: [
          {
            id: 'refuser',
            before: async (ctx) => {
              throw await ctx.fault({
                faultKind: 'executor_raised',
                message: 'no',
              });
            },
          },
        ],
      }),
      { dependencies: watched.dependency },
    );
    expect(watched.calls.closed).toHaveLength(1);
  });

  it('is still closed after a supplied identifier repeats', async () => {
    const watched = heldDependencies({ db: 'connection' });
    await openOne(orderHandler({ middleware: [{ id: 'same' }] }), {
      dependencies: watched.dependency,
      middleware: [{ id: 'same' }],
    });
    expect(watched.calls.closed).toHaveLength(1);
  });

  it('is open while every part runs, and the layers read what it exposes', async () => {
    const watched = openedPerExecution(() => ({ tenant: 't-1' }));
    let seenBefore: unknown;
    let seenAfter: unknown;
    await openOne(
      orderHandler({
        middleware: [
          {
            id: 'reader',
            before: (ctx) => {
              seenBefore = (ctx.dependencies as { tenant?: string } | null)
                ?.tenant;
            },
            after: (ctx) => {
              seenAfter = (ctx.dependencies as { tenant?: string } | null)
                ?.tenant;
            },
          },
        ],
      }),
      { dependencies: watched.dependency },
    );
    expect(seenBefore).toBe('t-1');
    expect(seenAfter).toBe('t-1');
  });

  it('closing badly after layers ran changes nothing', async () => {
    const watched = failingToClose({ db: 'x' }, new Error('would not close'));
    const ran = await openOne(
      orderHandler({ middleware: [{ id: 'w', after: () => undefined }] }),
      {
        dependencies: watched.dependency,
      },
    );
    expect(ran.ok && ran.value.kind).toBe('produced');
  });
});
