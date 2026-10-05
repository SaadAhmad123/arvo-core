import type { SpanContext } from '@opentelemetry/api';
import { TraceState } from '@opentelemetry/core';
import type { Resource } from '@opentelemetry/resources';
import type {
  ReadableSpan,
  SpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import type {
  OpenTelemetryWorkflowExporter,
  SerializableSpan,
} from '@temporalio/interceptors-opentelemetry';
import type { InjectedSink } from '@temporalio/worker';

/**
 * Workflow spans, on their way into this process's own pipeline.
 *
 * Workflow code runs in an isolate that can reach nothing, so the spans
 * it makes leave only through a sink. Temporal ships one, and it cannot
 * be used here: its OpenTelemetry integration is built against the SDK's
 * first major line and this process is on its second, so the two
 * `SpanProcessor` types are no longer the same type.
 *
 * The serializable form is therefore rebuilt field by field, with
 * nothing asserted across the boundary. One pipeline, one resource, one
 * batch schedule for every signal this worker produces.
 */

/** A trace state read back from the string the isolate sent. */
const traceStateFrom = (sent: string | undefined): TraceState | undefined =>
  sent === undefined ? undefined : new TraceState(sent);

/** The parent's context, rebuilt from the id the isolate sent. */
const parentContextOf = (span: SerializableSpan): SpanContext | undefined =>
  span.parentSpanId === undefined
    ? undefined
    : {
        // a parent is in the same trace, which is why only its id is sent
        traceId: span.spanContext.traceId,
        spanId: span.parentSpanId,
        traceFlags: span.spanContext.traceFlags,
      };

/** One workflow span, in the shape this process's exporters take. */
const readableFrom = (
  span: SerializableSpan,
  resource: Resource,
): ReadableSpan => ({
  name: span.name,
  kind: span.kind,
  spanContext: () => ({
    traceId: span.spanContext.traceId,
    spanId: span.spanContext.spanId,
    traceFlags: span.spanContext.traceFlags,
    traceState: traceStateFrom(span.spanContext.traceState),
  }),
  parentSpanContext: parentContextOf(span),
  startTime: span.startTime,
  endTime: span.endTime,
  status: span.status,
  attributes: span.attributes,
  links: span.links,
  events: span.events,
  duration: span.duration,
  ended: span.ended,
  resource,
  instrumentationScope: span.instrumentationLibrary,
  droppedAttributesCount: span.droppedAttributesCount,
  droppedEventsCount: span.droppedEventsCount,
  droppedLinksCount: span.droppedLinksCount,
});

/**
 * The sink workflow code exports its spans through.
 *
 * @param spanProcessor - Where every other span this process makes goes.
 * @param resource - What names this process on all of them.
 */
export const workflowSpanSink = (
  spanProcessor: SpanProcessor,
  resource: Resource,
): InjectedSink<OpenTelemetryWorkflowExporter> => ({
  export: {
    fn: (_info, spans) => {
      for (const span of spans) {
        spanProcessor.onEnd(readableFrom(span, resource));
      }
    },
    // a replayed task remakes spans for work already recorded
    callDuringReplay: false,
  },
});
