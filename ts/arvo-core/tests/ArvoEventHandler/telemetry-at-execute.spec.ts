import { afterEach, describe, expect, it } from 'vitest';
import { createArvoEventFactory } from '../../src/factories/ArvoEventFactory/index.js';
import { setupArvoEventHandler } from '../../src/factories/setupArvoEventHandler.js';
import type { JSONObject } from '../../src/types.js';
import {
  recordingLogger,
  recordingProvider,
  unregisterProviders,
} from '../recording-provider.js';
import { orderContract, orderVersion } from './fixtures.js';

afterEach(() => {
  unregisterProviders();
});

/** The span every execution of the order handler opens. */
const EXECUTION_SPAN = `${orderContract.type}.execute`;

const orderHandler = () =>
  setupArvoEventHandler({ contracts: { self: orderContract } })
    .handler('1.0.0', async () => {})
    .build();

const anOrder = (subject = 'order-1') =>
  createArvoEventFactory(orderVersion).createInput({
    source: 'com.web.checkout',
    subject,
    to: orderVersion.type,
    data: { items: ['book'] },
  });

const noRecord = () => (): JSONObject | null => null;

const executionSpans = (
  finished: ReturnType<ReturnType<typeof recordingProvider>['finished']>,
) => finished.filter((span) => span.name === EXECUTION_SPAN);

describe('where an execution records, given with the execution', () => {
  it('starts the span on the tracer given with the call', async () => {
    const recording = recordingProvider();
    await orderHandler().execute({
      event: anOrder(),
      state: noRecord(),
      attempt: 0,
      telemetry: { tracer: recording.tracer },
    });
    expect(executionSpans(recording.finished())).toHaveLength(1);
  });

  it('records through the provider registered at the call where none is given', async () => {
    const recording = recordingProvider();
    recording.registerAsAnApplicationWould();
    await orderHandler().execute({
      event: anOrder(),
      state: noRecord(),
      attempt: 0,
    });
    expect(executionSpans(recording.finished())).toHaveLength(1);
  });

  it('records through a provider registered after the handler was built', async () => {
    const handler = orderHandler();
    const recording = recordingProvider();
    recording.registerAsAnApplicationWould();
    await handler.execute({ event: anOrder(), state: noRecord(), attempt: 0 });
    expect(executionSpans(recording.finished())).toHaveLength(1);
  });

  it('starts each execution’s span on its own tracer, and neither on the other’s', async () => {
    const handler = orderHandler();
    const first = recordingProvider();
    const second = recordingProvider();
    await handler.execute({
      event: anOrder('order-1'),
      state: noRecord(),
      attempt: 0,
      telemetry: { tracer: first.tracer },
    });
    await handler.execute({
      event: anOrder('order-2'),
      state: noRecord(),
      attempt: 0,
      telemetry: { tracer: second.tracer },
    });
    const subjectsOn = (recording: ReturnType<typeof recordingProvider>) =>
      executionSpans(recording.finished()).map(
        (span) => span.attributes['arvo.subject'],
      );
    expect(subjectsOn(first)).toEqual(['order-1']);
    expect(subjectsOn(second)).toEqual(['order-2']);
  });

  it('keeps nothing given for one execution for the next', async () => {
    const handler = orderHandler();
    const logger = recordingLogger();
    const recording = recordingProvider();
    await handler.execute({
      event: anOrder('order-1'),
      state: noRecord(),
      attempt: 0,
      telemetry: { tracer: recording.tracer, logger },
    });
    const loggedByFirst = logger.records.length;
    expect(loggedByFirst).toBeGreaterThan(0);

    await handler.execute({
      event: anOrder('order-2'),
      state: noRecord(),
      attempt: 0,
      telemetry: { tracer: recording.tracer },
    });
    // given only a tracer, the second execution logs nowhere
    expect(logger.records).toHaveLength(loggedByFirst);
    expect(executionSpans(recording.finished())).toHaveLength(2);
  });

  it('records nothing and still executes where no telemetry is given and no provider is registered', async () => {
    const response = await orderHandler().execute({
      event: anOrder(),
      state: noRecord(),
      attempt: 0,
    });
    expect(response.kind).toBe('produced');
  });

  it('ignores telemetry named in a declaration by code no type checker saw', async () => {
    const recording = recordingProvider();
    const declaration = {
      contracts: { self: orderContract },
      telemetry: { tracer: recording.tracer },
    };
    // deliberately invalid: a declaration naming telemetry, as untyped code could write
    const handler = setupArvoEventHandler(declaration)
      .handler('1.0.0', async () => {})
      .build();
    await handler.execute({ event: anOrder(), state: noRecord(), attempt: 0 });
    expect(recording.finished()).toEqual([]);
  });
});
