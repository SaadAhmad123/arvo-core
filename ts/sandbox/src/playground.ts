/**
 * A scratch pad for trying out `arvo-core` (ts) as it currently exists on
 * disk -- not the last published npm release.
 *
 * `arvo-core` is linked here via `file:../arvo-core`, so this always sees
 * whatever is currently built into `ts/arvo-core/dist/`. If you've changed
 * `ts/arvo-core/src/`, run `pnpm run build` there first (or `pnpm run dev`
 * for anything that reads `src/` directly) before your edits show up here.
 *
 * Run this file with `pnpm run play`.
 */

import { ArvoEvent, ArvoEventSerializer } from "arvo-core";
import { trace, type SpanContext, TraceFlags } from "@opentelemetry/api";

// -- OpenTelemetry trace context --------------------------------------------
// A real app derives this from an active span (`trace.getActiveSpan()` /
// `tracer.startSpan(...)`). Here we build a SpanContext by hand -- valid
// 32-hex-char trace ID, 16-hex-char span ID -- and wrap it into a Span so
// ArvoEvent's constructor can derive `traceparent`/`tracestate` from it the
// same way it would from a real one. Tweak these values and re-run to see
// how they show up on the event.
const spanContext: SpanContext = {
  traceId: "0af7651916cd43dd8448eb211c80319",
  spanId: "b7ad6b7169203331",
  traceFlags: TraceFlags.SAMPLED,
  // traceState: undefined, // set via `new TraceState('key=value')` to play with tracestate
};
const span = trace.wrapSpanContext(spanContext);

const event = new ArvoEvent({
  subject: "order-42",
  source: "order-service",
  type: "order.created",
  data: { amount: 100 },
  dataschema: "#/contracts/order",
  span, // ArvoEvent derives traceparent/tracestate from this internally
});

console.log("traceparent:", event.traceparent);
console.log("tracestate:", event.tracestate);

const serializer = new ArvoEventSerializer();
const wire = await serializer.serialize(event);
console.log("wire:", wire);

const roundTripped = await serializer.deserialize(wire);
console.log("round-tripped traceparent matches:", roundTripped.traceparent === event.traceparent);
