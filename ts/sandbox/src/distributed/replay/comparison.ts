import type { JSONObject } from 'arvo-core';

/**
 * What two runs of the same events must agree on, and what they need
 * not.
 *
 * The protocol never asks a handler to be deterministic — that is why a
 * recovered delivery republishes the bytes it committed rather than
 * asking an executor to produce them again
 * (`docs/adr/006-arvoeventhandler-protocol.md`). So a replay cannot be
 * held to producing the same event identifiers, and holding it to that
 * would be testing a promise nothing made.
 *
 * What it can be held to is every decision: where each execution came to
 * rest, what it remembered, and what it emitted to whom. That is the
 * claim worth proving, because it is the claim the record being the
 * memory actually makes.
 *
 * Three things are therefore set aside, each for a stated reason:
 *
 * - an event's `id` and `time`, minted per event by whoever built it
 * - the trace it was carried on, which belongs to the run and not the
 *   decision
 * - the identifiers of events a record *emitted*, which are the same
 *   minted values seen from the record's side
 * - the position of every entry in the record's trail, which
 *   [ADR-015](../../../../../docs/adr/015-no-ordering-guarantee.md)
 *   forbids reading an order out of
 *
 * Nothing else is. The identifiers of events a record *received* are
 * compared, because a replay is delivered the very events the run was:
 * if those drifted, the replay would not be a replay.
 */

/** What is minted per event rather than decided. */
const MINTED = ['id', 'time', 'traceparent', 'tracestate'] as const;

/** One event, with what was minted for it set aside. */
const comparableEvent = (event: unknown): unknown => {
  if (event === null || typeof event !== 'object') return event;

  const fields = { ...(event as Record<string, unknown>) };
  for (const minted of MINTED) delete fields[minted];
  return fields;
};

/**
 * What a record touched, as an unordered collection.
 *
 * Sorted, because position carries nothing. The trail says which events
 * an execution touched and in which direction; ADR-007 promises nothing
 * about where in the list each sits, and ADR-015 forbids reading an
 * order out of it. An implementation whose list happens to be in the
 * order things occurred has not made that an interface, and a spec
 * comparing positions would be turning it into one.
 *
 * Emitted identifiers are set aside with the rest of what is minted, so
 * what is compared is how many events were emitted and which ones were
 * received.
 */
const comparableTouched = (touched: unknown): unknown => {
  if (!Array.isArray(touched)) return touched;

  return touched
    .map((one) => {
      const entry = one as { id?: unknown; direction?: unknown };
      return entry.direction === 'emitted'
        ? JSON.stringify({ direction: 'emitted' })
        : JSON.stringify({ direction: entry.direction, id: entry.id });
    })
    .sort();
};

/**
 * What a record is waiting on, as an unordered collection with the
 * identifier of the event it emitted to ask set aside.
 *
 * The answers themselves are compared in full: those arrived rather
 * than being minted here. Which questions are still outstanding is a
 * decision; which order they sit in is not.
 */
const comparableInFlight = (inFlight: unknown): unknown => {
  if (!Array.isArray(inFlight)) return inFlight;

  return inFlight
    .map((pair) => {
      const [, answer] = pair as [unknown, unknown];
      return JSON.stringify(comparableEvent(answer) ?? null);
    })
    .sort();
};

/**
 * One record as two runs of it can be compared.
 *
 * @param document - The record exactly as it was committed.
 */
export const comparableRecord = (document: JSONObject): JSONObject => ({
  ...document,
  initEvent: comparableEvent(document.initEvent) as JSONObject,
  triggeringEvent: comparableEvent(document.triggeringEvent) as JSONObject,
  eventIds: comparableTouched(document.eventIds) as JSONObject,
  inFlightEventMap: comparableInFlight(document.inFlightEventMap) as JSONObject,
});

/**
 * One event as two runs of it can be compared.
 *
 * @param payload - The event in the event's own format.
 */
export const comparablePayload = (payload: string): unknown =>
  comparableEvent(JSON.parse(payload));
