import {
  context as otelContext,
  TraceFlags,
  type Tracer,
  trace,
} from '@opentelemetry/api';
import { describe, expect, it } from 'vitest';
import { continueTraceFromEvent } from '../../src/ArvoEvent/opentelemetry.js';

const TRACE_ID = '0af7651916cd43dd8448eb211c80319c';
const SPAN_ID = 'b7ad6b7169203331';

/** A tracer that records what it was asked to start, and under what parent. */
const spy = () => {
  const started: { name: string; parentId: string | undefined }[] = [];
  const tracer = {
    startSpan: (name: string, _options: unknown, parent: unknown) => {
      const of = trace.getSpan(
        (parent ?? otelContext.active()) as Parameters<typeof trace.getSpan>[0],
      );
      started.push({ name, parentId: of?.spanContext().spanId });
      return trace.getTracer('fallback').startSpan(name);
    },
  } as unknown as Tracer;
  return { tracer, started };
};

/** An event by its trace headers alone, which is all this reads. */
const arriving = (
  traceparent: string | null,
  tracestate: string | null = null,
) => ({
  traceparent,
  tracestate,
});

describe('continuing the trace an event arrived on', () => {
  it('gives back both ends of the join', () => {
    const joined = continueTraceFromEvent(
      arriving(`00-${TRACE_ID}-${SPAN_ID}-01`),
      spy().tracer,
      'delivery',
    );
    expect(joined?.span).toBeDefined();
    expect(joined?.parentSpan).toBeDefined();
  });

  it('rebuilds the producer span from the headers', () => {
    const joined = continueTraceFromEvent(
      arriving(`00-${TRACE_ID}-${SPAN_ID}-01`),
      spy().tracer,
      'delivery',
    );
    const parent = joined?.parentSpan.spanContext();
    expect(parent?.traceId).toBe(TRACE_ID);
    expect(parent?.spanId).toBe(SPAN_ID);
    expect(parent?.traceFlags).toBe(TraceFlags.SAMPLED);
  });

  it('marks that span remote, it having happened elsewhere', () => {
    const joined = continueTraceFromEvent(
      arriving(`00-${TRACE_ID}-${SPAN_ID}-01`),
      spy().tracer,
      'delivery',
    );
    expect(joined?.parentSpan.spanContext().isRemote).toBe(true);
  });

  it('starts the new span under that parent, not under whatever was active', () => {
    const watched = spy();
    continueTraceFromEvent(
      arriving(`00-${TRACE_ID}-${SPAN_ID}-01`),
      watched.tracer,
      'delivery',
    );
    expect(watched.started).toEqual([{ name: 'delivery', parentId: SPAN_ID }]);
  });

  it('carries the trace state the event arrived with', () => {
    const joined = continueTraceFromEvent(
      arriving(`00-${TRACE_ID}-${SPAN_ID}-01`, 'vendor=value'),
      spy().tracer,
      'delivery',
    );
    expect(joined?.parentSpan.spanContext().traceState?.get('vendor')).toBe(
      'value',
    );
  });

  it('carries no trace state where the event had none', () => {
    const joined = continueTraceFromEvent(
      arriving(`00-${TRACE_ID}-${SPAN_ID}-01`),
      spy().tracer,
      'delivery',
    );
    expect(joined?.parentSpan.spanContext().traceState).toBeUndefined();
  });

  it('reads the flags the producer set', () => {
    const joined = continueTraceFromEvent(
      arriving(`00-${TRACE_ID}-${SPAN_ID}-00`),
      spy().tracer,
      'delivery',
    );
    expect(joined?.parentSpan.spanContext().traceFlags).toBe(TraceFlags.NONE);
  });
});

describe('an event with no trace to continue', () => {
  it("gives back nothing, the decision to start one being the caller's", () => {
    expect(
      continueTraceFromEvent(arriving(null), spy().tracer, 'delivery'),
    ).toBeNull();
  });

  it('starts nothing', () => {
    const watched = spy();
    continueTraceFromEvent(arriving(null), watched.tracer, 'delivery');
    expect(watched.started).toEqual([]);
  });

  it.each([
    ['an empty header', ''],
    ['a header of the wrong shape', 'not-a-traceparent'],
    ['an unsupported version', `01-${TRACE_ID}-${SPAN_ID}-01`],
    ['a short trace id', `00-${'a'.repeat(31)}-${SPAN_ID}-01`],
    ['a short span id', `00-${TRACE_ID}-${'a'.repeat(15)}-01`],
    ['uppercase hex', `00-${TRACE_ID.toUpperCase()}-${SPAN_ID}-01`],
    ['missing flags', `00-${TRACE_ID}-${SPAN_ID}`],
  ])(
    'treats %s as none, a span parented to nonsense being worse',
    (_label, traceparent) => {
      expect(
        continueTraceFromEvent(arriving(traceparent), spy().tracer, 'delivery'),
      ).toBeNull();
    },
  );
});

describe('reaching it as a consumer', () => {
  it('is on the package surface, a mechanism being the one that needs it', async () => {
    const surface = await import('../../src/index.js');
    expect(typeof surface.continueTraceFromEvent).toBe('function');
    expect(typeof surface.traceContextFromSpan).toBe('function');
  });
});
