import { SpanStatusCode, trace } from '@opentelemetry/api';
import {
  InMemorySpanExporter,
  type ReadableSpan,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import {
  type ArvoEvent,
  ArvoEventHandler,
  mutateArvoEvent,
  traceContextFromSpan,
} from 'arvo-core';
import { Pool } from 'pg';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  deliverOnce,
  deliverWithRetries,
} from '../../../src/distributed/replay/delivery.js';
import { readConfig } from '../../../src/distributed/shared/config.js';
import {
  injectFailure,
  withDeliveryInScope,
} from '../../../src/distributed/shared/delivery-middleware.js';
import { dispatcherFor } from '../../../src/distributed/shared/dispatcher.js';
import { storeFor } from '../../../src/distributed/shared/record-store.js';
import { anInventoryCheck, RETRYABLE_ONCE } from './injection.js';
import { anOrder, FrozenStockCatalogue, walkLattice } from './lattice-walk.js';

/**
 * A dispatcher's span, as a mechanism carrying real deliveries leaves it.
 *
 * Every module under test is loaded before the provider is registered, as
 * a worker loads its handlers and then starts its SDK. Telemetry is taken
 * per call, never at import, so spans record regardless.
 *
 * Needs the stack up and migrated.
 */

/** The span every dispatcher call opens. */
const DISPATCHER_SPAN = 'arvo.dispatcher.execute';

const exporter = new InMemorySpanExporter();
const provider = new NodeTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});

/** Every finished span by name. */
const named = (name: string): ReadableSpan[] =>
  exporter.getFinishedSpans().filter((span) => span.name === name);

/** The spans opened directly under one span. */
const childrenOf = (parent: ReadableSpan): ReadableSpan[] =>
  exporter
    .getFinishedSpans()
    .filter(
      (span) => span.parentSpanContext?.spanId === parent.spanContext().spanId,
    );

/** An event carrying the trace context of a caller's span, as one arriving from elsewhere does. */
const fromCaller = (event: ArvoEvent) => {
  const caller = trace.getTracer('caller').startSpan('caller');
  const carried = mutateArvoEvent(event, { span: caller });
  caller.end();
  return { carried, caller };
};

describe('a dispatcher’s span under a mechanism', () => {
  let pool: Pool;
  let scope: Parameters<typeof deliverOnce>[0];

  beforeAll(() => {
    // registered only now, after every module under test was loaded
    provider.register();
    const config = readConfig('arvo-dispatcher-telemetry-spec');
    pool = new Pool({
      connectionString: config.recordsUrl,
      max: config.recordsPoolSize,
    });
    scope = { store: storeFor(pool), pool };
  });

  afterEach(() => {
    exporter.reset();
    injectFailure(null);
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await provider.shutdown();
    await pool?.end();
  });

  it('opens one span per delivery, which the handler’s span sits under', async () => {
    const { carried } = fromCaller(anInventoryCheck('one-span'));
    await deliverOnce(scope, carried, 0);

    const spans = named(DISPATCHER_SPAN);
    expect(spans).toHaveLength(1);
    const [dispatcherSpan] = spans;
    if (dispatcherSpan === undefined) return;
    expect(dispatcherSpan.ended).toBe(true);
    expect(dispatcherSpan.status.code).toBe(SpanStatusCode.OK);

    const children = childrenOf(dispatcherSpan);
    expect(children).toHaveLength(1);
    // the mechanism's own layer ran inside the handler, on its span
    expect(children[0]?.attributes['arvo.sandbox.mechanism']).toBe('replay');
  });

  it('continues the trace the delivered event carries', async () => {
    const { carried, caller } = fromCaller(anInventoryCheck('continues'));
    await deliverOnce(scope, carried, 0);

    const [dispatcherSpan] = named(DISPATCHER_SPAN);
    expect(dispatcherSpan?.spanContext().traceId).toBe(
      caller.spanContext().traceId,
    );
    expect(dispatcherSpan?.parentSpanContext?.spanId).toBe(
      caller.spanContext().spanId,
    );
  });

  it('marks which handler it picked', async () => {
    const event = anInventoryCheck('picked');
    await deliverOnce(scope, event, 0);

    const [dispatcherSpan] = named(DISPATCHER_SPAN);
    const picked = dispatcherSpan?.events.find(
      (mark) => mark.name === 'arvo.dispatcher.picked',
    );
    expect(picked?.attributes?.['contract.type']).toBe(event.to);
  });

  it('hands the handler a copy naming its span, and leaves the delivered event alone', async () => {
    const entered = vi.spyOn(ArvoEventHandler.prototype, 'tryExecute');
    const { carried } = fromCaller(anInventoryCheck('copy'));
    const before = carried.toString();
    await deliverOnce(scope, carried, 0);

    const [dispatcherSpan] = named(DISPATCHER_SPAN);
    const received = entered.mock.calls[0]?.[0].event;
    expect(received).not.toBe(carried);
    expect(dispatcherSpan).toBeDefined();
    if (dispatcherSpan === undefined) return;
    expect(received?.traceparent).toBe(
      traceContextFromSpan(dispatcherSpan.spanContext()).traceparent,
    );
    expect(received?.id).toBe(carried.id);
    expect(received?.data).toEqual(carried.data);
    expect(carried.toString()).toBe(before);
  });

  it('opens one span per attempt, each of them successful where the handler answered with a fault', async () => {
    injectFailure(RETRYABLE_ONCE);
    const { carried, caller } = fromCaller(anInventoryCheck('per-attempt'));
    const report = await deliverWithRetries(scope, carried);
    expect(report.lifecycle).toBe('success');

    const spans = named(DISPATCHER_SPAN);
    expect(spans).toHaveLength(2);
    for (const span of spans) {
      expect(span.ended).toBe(true);
      // the fault was the handler's; the dispatcher's call went as it should
      expect(span.status.code).toBe(SpanStatusCode.OK);
      expect(span.parentSpanContext?.spanId).toBe(caller.spanContext().spanId);
    }
    expect(new Set(spans.map((span) => span.spanContext().spanId)).size).toBe(
      2,
    );
  });

  it('fails its span, with the exception on it, where no handler takes the event', async () => {
    const event = mutateArvoEvent(anInventoryCheck('miss'), {
      to: 'com.some.client',
    });
    await dispatcherFor('replay').tryExecute({
      event,
      state: () => null,
      attempt: 0,
    });

    const [dispatcherSpan] = named(DISPATCHER_SPAN);
    expect(dispatcherSpan?.status.code).toBe(SpanStatusCode.ERROR);
    expect(dispatcherSpan?.status.message).toContain('com.some.client');
    expect(
      dispatcherSpan?.events.filter((mark) => mark.name === 'exception'),
    ).toHaveLength(1);
    // nothing was entered, so nothing sits under it
    if (dispatcherSpan !== undefined) {
      expect(childrenOf(dispatcherSpan)).toEqual([]);
    }
  });

  it('keeps a whole run in one trace, each hop’s dispatcher under the handler that asked for it', async () => {
    const { carried, caller } = fromCaller(anOrder('one-trace'));
    const catalogue = new FrozenStockCatalogue(pool);
    const walk = await walkLattice(carried, (event, state) =>
      withDeliveryInScope(event, () =>
        dispatcherFor('replay').tryExecute({
          event,
          state,
          attempt: 0,
          dependencies: Object.fromEntries(
            dispatcherFor('replay').handlers.map((handler) => [
              handler.contracts.self.type,
              catalogue,
            ]),
          ),
        }),
      ),
    );

    const dispatcherSpans = named(DISPATCHER_SPAN);
    expect(dispatcherSpans).toHaveLength(walk.steps.length);
    expect(walk.steps.length).toBeGreaterThan(5);

    const handlerSpanIds = new Set(
      dispatcherSpans.flatMap((span) =>
        childrenOf(span).map((child) => child.spanContext().spanId),
      ),
    );
    expect(handlerSpanIds.size).toBe(walk.steps.length);

    for (const span of dispatcherSpans) {
      expect(span.spanContext().traceId).toBe(caller.spanContext().traceId);
      const parent = span.parentSpanContext?.spanId;
      // the opening hop continues the caller; every other continues the
      // handler span that emitted its event, passed on as returned
      expect(
        parent === caller.spanContext().spanId ||
          (parent !== undefined && handlerSpanIds.has(parent)),
      ).toBe(true);
    }
    expect(
      dispatcherSpans.filter(
        (span) =>
          span.parentSpanContext?.spanId === caller.spanContext().spanId,
      ),
    ).toHaveLength(1);
  });

  it('counts one span per delivery across deliveries running at once', async () => {
    const events = Array.from({ length: 8 }, (_, index) =>
      anInventoryCheck(`concurrent-${index}`),
    );
    await Promise.all(events.map((event) => deliverOnce(scope, event, 0)));

    const spans = named(DISPATCHER_SPAN);
    expect(spans).toHaveLength(events.length);
    for (const span of spans) expect(childrenOf(span)).toHaveLength(1);
    // each delivery's own trace, none borrowed from another running beside it
    expect(new Set(spans.map((span) => span.spanContext().traceId)).size).toBe(
      events.length,
    );
  });
});
