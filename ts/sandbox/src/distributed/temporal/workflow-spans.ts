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
 * Workflow code runs in an isolate with no access to anything outside
 * it, so the spans it creates cannot be exported from where they are
 * made. Temporal's answer is a sink: the isolate hands out a plain,
 * serializable description of each finished span and something on this
 * side exports it.
 *
 * Temporal ships a ready-made sink for that, and this does not use it.
 * The reason is a version boundary rather than a preference: Temporal's
 * OpenTelemetry integration is built against the OpenTelemetry JS SDK's
 * first major line, and this process is on its second, so the two
 * `SpanProcessor` types are no longer the same type. Handing one to the
 * other does not compile, and the shapes differ in substance as well as
 * in name — a span now carries a parent's whole context where it used to
 * carry a parent's id.
 *
 * So the serializable form is turned into a span of the shape this
 * process's pipeline exports, field by field, with nothing asserted
 * across the boundary. That keeps one pipeline, one resource and one
 * batch schedule for every signal this worker produces, which is what
 * makes a workflow span and an activity span arrive as parts of one
 * trace rather than as two traces that happen to agree.
 */

/** A trace state read back from the string the isolate sent it as. */
const traceStateFrom = (sent: string | undefined): TraceState | undefined =>
  sent === undefined ? undefined : new TraceState(sent);

/** The parent's context, rebuilt from the id the isolate sent. */
const parentContextOf = (span: SerializableSpan): SpanContext | undefined =>
  span.parentSpanId === undefined
    ? undefined
    : {
        // A parent is in the same trace by definition, and the
        // serializable form sends only the id because of it.
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
  // This process's own, so a workflow span and an activity span name the
  // same service rather than two.
  resource,
  instrumentationScope: span.instrumentationLibrary,
  droppedAttributesCount: span.droppedAttributesCount,
  droppedEventsCount: span.droppedEventsCount,
  droppedLinksCount: span.droppedLinksCount,
});

/**
 * The sink workflow code exports its spans through.
 *
 * @param spanProcessor - Where spans go, which is the same place every
 * other span this process produces goes.
 * @param resource - What names this process, which must be the one the
 * rest of its signals carry.
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
    // A replayed workflow task re-creates spans for work that was
    // already recorded, and exporting them again would double every
    // span of every execution that was ever retried.
    callDuringReplay: false,
  },
});
