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

const noStoredRecord = () => (): JSONObject | null => null;

const executionSpans = (
  finishedSpans: ReturnType<
    ReturnType<typeof recordingProvider>['finishedSpans']
  >,
) => finishedSpans.filter((span) => span.name === EXECUTION_SPAN);

describe('where an execution records, given with the execution', () => {
  it('starts the span on the tracer given with the call', async () => {
    const spanRecorder = recordingProvider();
    await orderHandler().execute({
      event: anOrder(),
      state: noStoredRecord(),
      attempt: 0,
      telemetry: { tracer: spanRecorder.tracer },
    });
    expect(executionSpans(spanRecorder.finishedSpans())).toHaveLength(1);
  });

  it('records through the provider registered at the call where none is given', async () => {
    const spanRecorder = recordingProvider();
    spanRecorder.registerAsAnApplicationWould();
    await orderHandler().execute({
      event: anOrder(),
      state: noStoredRecord(),
      attempt: 0,
    });
    expect(executionSpans(spanRecorder.finishedSpans())).toHaveLength(1);
  });

  it('records through a provider registered after the handler was built', async () => {
    const handler = orderHandler();
    const spanRecorder = recordingProvider();
    spanRecorder.registerAsAnApplicationWould();
    await handler.execute({
      event: anOrder(),
      state: noStoredRecord(),
      attempt: 0,
    });
    expect(executionSpans(spanRecorder.finishedSpans())).toHaveLength(1);
  });

  it('starts each execution’s span on its own tracer, and neither on the other’s', async () => {
    const handler = orderHandler();
    const providerForOrderOne = recordingProvider();
    const providerForOrderTwo = recordingProvider();
    await handler.execute({
      event: anOrder('order-1'),
      state: noStoredRecord(),
      attempt: 0,
      telemetry: { tracer: providerForOrderOne.tracer },
    });
    await handler.execute({
      event: anOrder('order-2'),
      state: noStoredRecord(),
      attempt: 0,
      telemetry: { tracer: providerForOrderTwo.tracer },
    });
    const subjectsRecordedBy = (
      provider: ReturnType<typeof recordingProvider>,
    ) =>
      executionSpans(provider.finishedSpans()).map(
        (span) => span.attributes['arvo.subject'],
      );
    expect(subjectsRecordedBy(providerForOrderOne)).toEqual(['order-1']);
    expect(subjectsRecordedBy(providerForOrderTwo)).toEqual(['order-2']);
  });

  it('keeps nothing given for one execution for the next', async () => {
    const handler = orderHandler();
    const logger = recordingLogger();
    const spanRecorder = recordingProvider();
    await handler.execute({
      event: anOrder('order-1'),
      state: noStoredRecord(),
      attempt: 0,
      telemetry: { tracer: spanRecorder.tracer, logger },
    });
    const recordsLoggedByOrderOne = logger.records.length;
    expect(recordsLoggedByOrderOne).toBeGreaterThan(0);

    await handler.execute({
      event: anOrder('order-2'),
      state: noStoredRecord(),
      attempt: 0,
      telemetry: { tracer: spanRecorder.tracer },
    });
    // given only a tracer, the second execution logs nowhere
    expect(logger.records).toHaveLength(recordsLoggedByOrderOne);
    expect(executionSpans(spanRecorder.finishedSpans())).toHaveLength(2);
  });

  it('records nothing and still executes where no telemetry is given and no provider is registered', async () => {
    const response = await orderHandler().execute({
      event: anOrder(),
      state: noStoredRecord(),
      attempt: 0,
    });
    expect(response.kind).toBe('produced');
  });

  it('ignores telemetry named in a declaration by code no type checker saw', async () => {
    const spanRecorder = recordingProvider();
    const declaration = {
      contracts: { self: orderContract },
      telemetry: { tracer: spanRecorder.tracer },
    };
    // deliberately invalid: a declaration naming telemetry, as untyped code could write
    const handler = setupArvoEventHandler(declaration)
      .handler('1.0.0', async () => {})
      .build();
    await handler.execute({
      event: anOrder(),
      state: noStoredRecord(),
      attempt: 0,
    });
    expect(spanRecorder.finishedSpans()).toEqual([]);
  });
});
