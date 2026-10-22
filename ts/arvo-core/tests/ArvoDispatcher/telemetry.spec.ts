import { SpanStatusCode } from '@opentelemetry/api';
import {
  InMemorySpanExporter,
  type ReadableSpan,
  SimpleSpanProcessor,
  TracerProvider,
} from '@opentelemetry/sdk-trace';
import { err } from 'neverthrow';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArvoDispatcher } from '../../src/ArvoDispatcher/index.js';
import { ArvoHandlerFault } from '../../src/ArvoEventHandler/fault/index.js';
import { ArvoEventHandler } from '../../src/ArvoEventHandler/index.js';
import { fromNeverthrow } from '../../src/result.js';
import {
  CALLER_TRACEPARENT,
  DISPATCHER_SPAN,
  fakeStore,
  orderHandlerUnderTest,
  orderRequest,
} from './execution.js';

afterEach(() => {
  vi.restoreAllMocks();
});

/** A dispatcher and its handler, both recording into one in-memory exporter. */
const traced = () => {
  const exporter = new InMemorySpanExporter();
  const provider = new TracerProvider({
    spanProcessors: [new SimpleSpanProcessor({ exporter })],
  });
  const tracer = provider.getTracer('dispatcher-test');
  const order = orderHandlerUnderTest();
  const dispatcher = new ArvoDispatcher({
    handlers: [order],
    telemetry: { tracer },
  });
  const run = (event = orderRequest({ traceparent: CALLER_TRACEPARENT })) =>
    dispatcher.tryExecute({ event, state: fakeStore().read(), attempt: 0 });
  const finished = () => exporter.getFinishedSpans();
  const dispatcherSpan = (): ReadableSpan => {
    const spans = finished().filter((span) => span.name === DISPATCHER_SPAN);
    if (spans.length !== 1) {
      throw new Error(`expected one dispatcher span, found ${spans.length}`);
    }
    return spans[0] as ReadableSpan;
  };
  const handlerSpan = (): ReadableSpan | undefined =>
    finished().find((span) => span.name !== DISPATCHER_SPAN);
  return { dispatcher, run, finished, dispatcherSpan, handlerSpan };
};

const handlerFault = () =>
  new ArvoHandlerFault({
    faultKind: 'record_invalid',
    message: 'the handler refused',
    cause: null,
    violations: [],
    subject: 'order-1',
    executionId: null,
    eventId: 'event-1',
    attempt: 0,
    timestamp: 0,
    retry: null,
    abandonmentEvent: null,
    abandonmentState: null,
  });

const exceptionsOn = (span: ReadableSpan) =>
  span.events.filter((spanEvent) => spanEvent.name === 'exception');

describe('a dispatcher’s span', () => {
  it('opens exactly one per call, and ends it', async () => {
    const { run, dispatcherSpan } = traced();
    await run();
    expect(dispatcherSpan().ended).toBe(true);
  });

  it('continues the event’s trace as a child of the context it names', async () => {
    const { run, dispatcherSpan } = traced();
    await run();
    expect(dispatcherSpan().spanContext().traceId).toBe('c'.repeat(32));
    expect(dispatcherSpan().parentSpanContext?.spanId).toBe('d'.repeat(16));
  });

  it('begins a new trace for an event naming none', async () => {
    const { run, dispatcherSpan } = traced();
    await run(orderRequest());
    expect(dispatcherSpan().parentSpanContext).toBeUndefined();
  });

  it('ends its span on a miss', async () => {
    const { run, dispatcherSpan } = traced();
    await run(orderRequest({ to: 'com_nowhere' }));
    expect(dispatcherSpan().ended).toBe(true);
  });

  it('ends its span when something that is not a fault is thrown', async () => {
    const { run, dispatcherSpan } = traced();
    vi.spyOn(ArvoEventHandler.prototype, 'tryExecute').mockRejectedValue(
      new Error('a bug'),
    );
    await expect(run()).rejects.toThrow('a bug');
    expect(dispatcherSpan().ended).toBe(true);
  });

  it('nests the handler’s span under its own', async () => {
    const { run, dispatcherSpan, handlerSpan } = traced();
    await run();
    expect(handlerSpan()?.parentSpanContext?.spanId).toBe(
      dispatcherSpan().spanContext().spanId,
    );
    expect(handlerSpan()?.spanContext().traceId).toBe('c'.repeat(32));
  });

  it('enters the handler with a copy naming its span, every other field the event’s', async () => {
    const { run, dispatcherSpan } = traced();
    const entered = vi.spyOn(ArvoEventHandler.prototype, 'tryExecute');
    const given = orderRequest({ traceparent: CALLER_TRACEPARENT });
    await run(given);
    const received = entered.mock.calls[0]?.[0].event;
    expect(received?.traceparent).toContain(
      dispatcherSpan().spanContext().spanId,
    );
    expect(received?.id).toBe(given.id);
    expect(received?.subject).toBe(given.subject);
    expect(received?.data).toEqual(given.data);
    expect(received?.time).toBe(given.time);
  });

  it('leaves the event it was given unchanged', async () => {
    const { run } = traced();
    const given = orderRequest({ traceparent: CALLER_TRACEPARENT });
    const before = given.toString();
    await run(given);
    expect(given.toString()).toBe(before);
  });

  it('enters the handler with the event itself where its span is not recording', async () => {
    // no SDK is registered globally, so the default tracer's spans do not record
    const order = orderHandlerUnderTest();
    const entered = vi.spyOn(ArvoEventHandler.prototype, 'tryExecute');
    const given = orderRequest({ traceparent: CALLER_TRACEPARENT });
    await new ArvoDispatcher({ handlers: [order] }).tryExecute({
      event: given,
      state: fakeStore().read(),
      attempt: 0,
    });
    expect(entered.mock.calls[0]?.[0].event).toBe(given);
  });

  it('returns the handler’s events with the handler’s trace context', async () => {
    const { run, handlerSpan } = traced();
    const executed = await run();
    if (!executed.ok || executed.value.kind !== 'produced') {
      throw new Error('expected events');
    }
    expect(executed.value.events[0]?.traceparent).toContain(
      handlerSpan()?.spanContext().spanId,
    );
  });

  it('marks that it was entered and which handler it picked', async () => {
    const { run, dispatcherSpan } = traced();
    await run();
    const marks = dispatcherSpan().events;
    expect(marks.map((spanEvent) => spanEvent.name)).toEqual([
      'arvo.dispatcher.entered',
      'arvo.dispatcher.picked',
    ]);
    expect(marks[1]?.attributes?.['contract.type']).toBe('com_order_create');
  });

  it('records handler_not_found on its own span', async () => {
    const { run, dispatcherSpan } = traced();
    await run(orderRequest({ to: 'com_nowhere' }));
    expect(exceptionsOn(dispatcherSpan())).toHaveLength(1);
  });

  it('does not record a handler’s fault as its own', async () => {
    const { run, dispatcherSpan } = traced();
    vi.spyOn(ArvoEventHandler.prototype, 'tryExecute').mockResolvedValue(
      fromNeverthrow(err(handlerFault())),
    );
    await run();
    expect(exceptionsOn(dispatcherSpan())).toEqual([]);
  });
});

describe('the status of a dispatcher’s span', () => {
  it('is successful where the handler produced', async () => {
    const { run, dispatcherSpan } = traced();
    await run();
    expect(dispatcherSpan().status.code).toBe(SpanStatusCode.OK);
  });

  it('is successful where the handler returned a fault of its own, the fault being the handler’s', async () => {
    const { run, dispatcherSpan } = traced();
    vi.spyOn(ArvoEventHandler.prototype, 'tryExecute').mockResolvedValue(
      fromNeverthrow(err(handlerFault())),
    );
    await run();
    expect(dispatcherSpan().status.code).toBe(SpanStatusCode.OK);
  });

  it('is failed where no handler takes the event', async () => {
    const { run, dispatcherSpan } = traced();
    await run(orderRequest({ to: 'com_nowhere' }));
    expect(dispatcherSpan().status.code).toBe(SpanStatusCode.ERROR);
    expect(dispatcherSpan().status.message).toContain('com_nowhere');
  });

  it('is failed, with the exception recorded, where something that is not a fault was thrown', async () => {
    const { run, dispatcherSpan } = traced();
    vi.spyOn(ArvoEventHandler.prototype, 'tryExecute').mockRejectedValue(
      new Error('a bug'),
    );
    await expect(run()).rejects.toThrow('a bug');
    expect(dispatcherSpan().status.code).toBe(SpanStatusCode.ERROR);
    expect(dispatcherSpan().status.message).toContain('a bug');
    expect(exceptionsOn(dispatcherSpan())).toHaveLength(1);
  });

  it('records something thrown that is not an Error as its text', async () => {
    const { run, dispatcherSpan } = traced();
    vi.spyOn(ArvoEventHandler.prototype, 'tryExecute').mockRejectedValue(
      'a bare string',
    );
    await expect(run()).rejects.toBe('a bare string');
    expect(exceptionsOn(dispatcherSpan())).toHaveLength(1);
    expect(dispatcherSpan().status.message).toContain('a bare string');
  });
});
