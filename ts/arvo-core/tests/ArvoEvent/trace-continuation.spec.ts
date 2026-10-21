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
const recordingTracer = () => {
  const startedSpans: { name: string; parentId: string | undefined }[] = [];
  const tracer = {
    startSpan: (name: string, _options: unknown, parentContext: unknown) => {
      const parentSpan = trace.getSpan(
        (parentContext ?? otelContext.active()) as Parameters<
          typeof trace.getSpan
        >[0],
      );
      startedSpans.push({ name, parentId: parentSpan?.spanContext().spanId });
      return trace.getTracer('fallback').startSpan(name);
    },
  } as unknown as Tracer;
  return { tracer, started: startedSpans };
};

/** An event by its trace headers alone, which is all this reads. */
const traceHeaders = (
  traceparent: string | null,
  tracestate: string | null = null,
) => ({
  traceparent,
  tracestate,
});

describe('continuing the trace an event arrived on', () => {
  it('gives back both ends of the join', () => {
    const joinedTrace = continueTraceFromEvent(
      traceHeaders(`00-${TRACE_ID}-${SPAN_ID}-01`),
      recordingTracer().tracer,
      'delivery',
    );
    expect(joinedTrace?.span).toBeDefined();
    expect(joinedTrace?.parentSpan).toBeDefined();
  });

  it('rebuilds the producer span from the headers', () => {
    const joinedTrace = continueTraceFromEvent(
      traceHeaders(`00-${TRACE_ID}-${SPAN_ID}-01`),
      recordingTracer().tracer,
      'delivery',
    );
    const producerSpanContext = joinedTrace?.parentSpan.spanContext();
    expect(producerSpanContext?.traceId).toBe(TRACE_ID);
    expect(producerSpanContext?.spanId).toBe(SPAN_ID);
    expect(producerSpanContext?.traceFlags).toBe(TraceFlags.SAMPLED);
  });

  it('marks that span remote, it having happened elsewhere', () => {
    const joinedTrace = continueTraceFromEvent(
      traceHeaders(`00-${TRACE_ID}-${SPAN_ID}-01`),
      recordingTracer().tracer,
      'delivery',
    );
    expect(joinedTrace?.parentSpan.spanContext().isRemote).toBe(true);
  });

  it('starts the new span under that parent, not under whatever was active', () => {
    const recorder = recordingTracer();
    continueTraceFromEvent(
      traceHeaders(`00-${TRACE_ID}-${SPAN_ID}-01`),
      recorder.tracer,
      'delivery',
    );
    expect(recorder.started).toEqual([{ name: 'delivery', parentId: SPAN_ID }]);
  });

  it('carries the trace state the event arrived with', () => {
    const joinedTrace = continueTraceFromEvent(
      traceHeaders(`00-${TRACE_ID}-${SPAN_ID}-01`, 'vendor=value'),
      recordingTracer().tracer,
      'delivery',
    );
    expect(
      joinedTrace?.parentSpan.spanContext().traceState?.get('vendor'),
    ).toBe('value');
  });

  it('carries no trace state where the event had none', () => {
    const joinedTrace = continueTraceFromEvent(
      traceHeaders(`00-${TRACE_ID}-${SPAN_ID}-01`),
      recordingTracer().tracer,
      'delivery',
    );
    expect(joinedTrace?.parentSpan.spanContext().traceState).toBeUndefined();
  });

  it('reads the flags the producer set', () => {
    const joinedTrace = continueTraceFromEvent(
      traceHeaders(`00-${TRACE_ID}-${SPAN_ID}-00`),
      recordingTracer().tracer,
      'delivery',
    );
    expect(joinedTrace?.parentSpan.spanContext().traceFlags).toBe(
      TraceFlags.NONE,
    );
  });
});

describe('an event with no trace to continue', () => {
  it("gives back nothing, the decision to start one being the caller's", () => {
    expect(
      continueTraceFromEvent(
        traceHeaders(null),
        recordingTracer().tracer,
        'delivery',
      ),
    ).toBeNull();
  });

  it('starts nothing', () => {
    const recorder = recordingTracer();
    continueTraceFromEvent(traceHeaders(null), recorder.tracer, 'delivery');
    expect(recorder.started).toEqual([]);
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
        continueTraceFromEvent(
          traceHeaders(traceparent),
          recordingTracer().tracer,
          'delivery',
        ),
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
