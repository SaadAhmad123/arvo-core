import { describe, expect, it, vi } from 'vitest';
import type { JSONObject } from '../../../src/types.js';
import {
  failingToClose,
  heldDependencies,
  openedPerExecution,
} from '../dependency.js';
import {
  answeringExecutor,
  askingPaymentTwiceExecutor,
  createInMemoryStore,
  executeOrder,
  orderHandler,
  orderRequest,
  paymentAnswerFor,
} from './fixture.js';

/**
 * The protocol around the chain, untouched by it.
 *
 * Layers that only read must leave an execution indistinguishable from
 * one with none, and the places the protocol says the executor is not
 * entered must enter no layer either.
 */

const readOnlyLayer = () => ({
  id: 'reader',
  before: (ctx: { state: unknown }) => void ctx.state,
  after: () => undefined,
});

/** The parts of a record that do not depend on fresh ids or clocks. */
const recordShape = (record: JSONObject) => ({
  executionId: record.executionId,
  subject: record.subject,
  casVersion: record.casVersion,
  lifecycle: record.lifecycle,
  depth: record.depth,
  version: record.version,
  data: record.data,
  directions: (record.eventIds as { direction: string }[]).map(
    (touchedEvent) => touchedEvent.direction,
  ),
  awaiting: Object.keys(record.inFlightEventMap as object).length,
});

describe('an execution whose layers only read', () => {
  it('produces a record of the same shape as one with no layers', async () => {
    const orderEvent = orderRequest();
    const bareResult = await executeOrder(orderHandler(), {
      event: orderEvent,
    });
    const layeredResult = await executeOrder(
      orderHandler({ middleware: [readOnlyLayer() as never] }),
      {
        event: orderEvent,
      },
    );
    const bareRecord =
      bareResult.ok && bareResult.value.kind === 'produced'
        ? bareResult.value.state
        : null;
    const layeredRecord =
      layeredResult.ok && layeredResult.value.kind === 'produced'
        ? layeredResult.value.state
        : null;
    expect(recordShape(layeredRecord as JSONObject)).toEqual(
      recordShape(bareRecord as JSONObject),
    );
  });

  it('hands the executor the same idempotency keys', async () => {
    const orderEvent = orderRequest();
    const idempotencyKeysSeen: unknown[] = [];
    const executorRecordingKeys = async (
      ctx: Parameters<typeof answeringExecutor>[0],
    ) => {
      idempotencyKeysSeen.push(ctx.idempotency);
      return answeringExecutor(ctx);
    };
    await executeOrder(orderHandler({ execute: executorRecordingKeys }), {
      event: orderEvent,
    });
    await executeOrder(
      orderHandler({
        execute: executorRecordingKeys,
        middleware: [readOnlyLayer() as never],
      }),
      {
        event: orderEvent,
      },
    );
    expect(idempotencyKeysSeen[1]).toEqual(idempotencyKeysSeen[0]);
  });

  it('asks the same services and waits on the same number of answers', async () => {
    const orderEvent = orderRequest();
    const bareResult = await executeOrder(
      orderHandler({ execute: askingPaymentTwiceExecutor }),
      {
        event: orderEvent,
      },
    );
    const layeredResult = await executeOrder(
      orderHandler({
        execute: askingPaymentTwiceExecutor,
        middleware: [readOnlyLayer() as never],
      }),
      { event: orderEvent },
    );
    const bareRecord =
      bareResult.ok && bareResult.value.kind === 'produced'
        ? bareResult.value
        : null;
    const layeredRecord =
      layeredResult.ok && layeredResult.value.kind === 'produced'
        ? layeredResult.value
        : null;
    expect(
      layeredRecord?.events.map((emittedEvent) => emittedEvent.type),
    ).toEqual(bareRecord?.events.map((emittedEvent) => emittedEvent.type));
    expect(recordShape(layeredRecord?.state as JSONObject)).toEqual(
      recordShape(bareRecord?.state as JSONObject),
    );
  });
});

describe('where the executor is not entered, no layer is', () => {
  it('enters none on a partial collection under the default join', async () => {
    const store = createInMemoryStore();
    const beforeSpy = vi.fn();
    const handler = orderHandler({
      execute: askingPaymentTwiceExecutor,
      middleware: [{ id: 'w', before: beforeSpy }],
    });
    const orderEvent = orderRequest();
    const askedResult = await executeOrder(handler, {
      store,
      event: orderEvent,
    });
    if (!askedResult.ok || askedResult.value.kind !== 'produced')
      throw new Error('nothing asked');
    store.commit(askedResult.value.state);
    beforeSpy.mockClear();

    const firstAnswer = paymentAnswerFor(
      askedResult.value.events[0] as { id: string; subject: string },
      askedResult.value.state.executionId as string,
    );
    const partialResult = await executeOrder(handler, {
      store,
      event: firstAnswer as never,
    });
    expect(partialResult.ok && partialResult.value.kind).toBe('produced');
    expect(beforeSpy).not.toHaveBeenCalled();
  });

  it('enters them once the collection completes', async () => {
    const store = createInMemoryStore();
    const beforeSpy = vi.fn();
    const handler = orderHandler({
      execute: askingPaymentTwiceExecutor,
      middleware: [{ id: 'w', before: beforeSpy }],
    });
    const askedResult = await executeOrder(handler, {
      store,
      event: orderRequest(),
    });
    if (!askedResult.ok || askedResult.value.kind !== 'produced')
      throw new Error('nothing asked');
    store.commit(askedResult.value.state);
    const executionId = askedResult.value.state.executionId as string;
    const [firstRequest, secondRequest] = askedResult.value
      .events as unknown as [
      { id: string; subject: string },
      { id: string; subject: string },
    ];

    const partialResult = await executeOrder(handler, {
      store,
      event: paymentAnswerFor(firstRequest, executionId) as never,
    });
    if (partialResult.ok && partialResult.value.kind === 'produced')
      store.commit(partialResult.value.state);
    beforeSpy.mockClear();
    const completingResult = await executeOrder(handler, {
      store,
      event: paymentAnswerFor(secondRequest, executionId) as never,
    });
    expect(
      completingResult.ok &&
        completingResult.value.kind === 'produced' &&
        completingResult.value.state.lifecycle,
    ).toBe('success');
    expect(beforeSpy).toHaveBeenCalledTimes(1);
  });

  it('enters none for an answer already taken in', async () => {
    const store = createInMemoryStore();
    const beforeSpy = vi.fn();
    const handler = orderHandler({
      execute: askingPaymentTwiceExecutor,
      middleware: [{ id: 'w', before: beforeSpy }],
    });
    const askedResult = await executeOrder(handler, {
      store,
      event: orderRequest(),
    });
    if (!askedResult.ok || askedResult.value.kind !== 'produced')
      throw new Error('nothing asked');
    store.commit(askedResult.value.state);
    const paymentAnswer = paymentAnswerFor(
      askedResult.value.events[0] as { id: string; subject: string },
      askedResult.value.state.executionId as string,
    );
    const firstDelivery = await executeOrder(handler, {
      store,
      event: paymentAnswer as never,
    });
    if (firstDelivery.ok && firstDelivery.value.kind === 'produced')
      store.commit(firstDelivery.value.state);
    beforeSpy.mockClear();
    const secondDelivery = await executeOrder(handler, {
      store,
      event: paymentAnswer as never,
    });
    expect(secondDelivery.ok && secondDelivery.value.kind).toBe('discarded');
    expect(beforeSpy).not.toHaveBeenCalled();
  });

  it('enters none where the dependency would not open', async () => {
    const beforeSpy = vi.fn();
    const executionResult = await executeOrder(
      orderHandler({ middleware: [{ id: 'w', before: beforeSpy }] }),
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
    expect(!executionResult.ok && executionResult.error.faultKind).toBe(
      'dependency_resolution_failed',
    );
    expect(beforeSpy).not.toHaveBeenCalled();
  });
});

describe('the dependency around a failing chain', () => {
  it('is still closed after a before part throws', async () => {
    const watchedDependency = openedPerExecution(() => ({ db: 'connection' }));
    await executeOrder(
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
      { dependencies: watchedDependency.dependency },
    );
    expect(watchedDependency.calls.opened).toHaveLength(1);
    expect(watchedDependency.calls.closed).toHaveLength(1);
  });

  it('is still closed after a before part faults', async () => {
    const watchedDependency = heldDependencies({ db: 'connection' });
    await executeOrder(
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
      { dependencies: watchedDependency.dependency },
    );
    expect(watchedDependency.calls.closed).toHaveLength(1);
  });

  it('is still closed after a supplied identifier repeats', async () => {
    const watchedDependency = heldDependencies({ db: 'connection' });
    await executeOrder(orderHandler({ middleware: [{ id: 'same' }] }), {
      dependencies: watchedDependency.dependency,
      middleware: [{ id: 'same' }],
    });
    expect(watchedDependency.calls.closed).toHaveLength(1);
  });

  it('is open while every part runs, and the layers read what it exposes', async () => {
    const watchedDependency = openedPerExecution(() => ({ tenant: 't-1' }));
    let seenBefore: unknown;
    let seenAfter: unknown;
    await executeOrder(
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
      { dependencies: watchedDependency.dependency },
    );
    expect(seenBefore).toBe('t-1');
    expect(seenAfter).toBe('t-1');
  });

  it('closing badly after layers ran changes nothing', async () => {
    const watchedDependency = failingToClose(
      { db: 'x' },
      new Error('would not close'),
    );
    const executionResult = await executeOrder(
      orderHandler({ middleware: [{ id: 'w', after: () => undefined }] }),
      {
        dependencies: watchedDependency.dependency,
      },
    );
    expect(executionResult.ok && executionResult.value.kind).toBe('produced');
  });
});
