import type { Span, SpanContext } from '@opentelemetry/api';
import {
  type ArvoEvent,
  cloneArvoEvent,
  traceContextFromSpan,
} from 'arvo-core';
import { handlerFor } from './routing.js';

/**
 * What is required of whoever sends an event into the lattice.
 *
 * Neither rule belongs to a mechanism — both are true of any event
 * entering from outside, under Temporal, under DBOS, or under a loop in
 * one process — so both live here rather than once per adapter.
 */

/**
 * Refuses a source that is a handler's own contract type.
 *
 * A run answers whatever sent the event in, by addressing its answer to
 * that `source`. A source that is also a handler here would make the
 * answer indistinguishable from work addressed to that handler, and the
 * run would deliver its own answer into the lattice instead of out of
 * it.
 *
 * @param source - The entering event's `source`.
 * @throws Where a handler in this lattice is named by it.
 */
export const checkSource = (source: string): void => {
  if (handlerFor(source) !== null) {
    throw new Error(
      `${source} is a handler in this lattice, so it cannot also be the source of an event entering it — an answer addressed there would be indistinguishable from work`,
    );
  }
};

/**
 * Stamps an event with a span's trace context, so what it causes belongs
 * to the trace that caused it.
 *
 * An event entering with no trace context of its own starts a trace of
 * its own, and everything the run does hangs off that instead of off the
 * caller.
 *
 * @param event - The event entering.
 * @param span - What the run belongs to, or nothing for a run that
 * belongs to itself.
 */
export const continuing = (
  event: ArvoEvent,
  span?: Span | SpanContext,
): ArvoEvent => {
  if (span === undefined) return event;
  const trace = traceContextFromSpan(span);
  return cloneArvoEvent(event, {
    traceparent: trace.traceparent,
    tracestate: trace.tracestate ?? undefined,
  });
};
