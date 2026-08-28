import type { Span, SpanContext } from '@opentelemetry/api';
import type { ArvoEventValidationError } from '../ArvoEvent/errors.js';
import type { ArvoEvent } from '../ArvoEvent/index.js';
import { traceContextFromSpan } from '../ArvoEvent/opentelemetry.js';
import type { ArvoEventParam } from '../ArvoEvent/types.js';
import type { Result } from '../types.js';
import { tryCreateArvoEvent } from './createArvoEvent.js';

/** A span if there is one, else an overridden header, else the event's own. */
const traceOf = <T extends string, D extends Record<string, any>>(
  event: ArvoEvent<T, D>,
  overrides: {
    traceparent?: string;
    tracestate?: string;
    span?: Span | SpanContext;
  },
) => {
  if (overrides.span) return traceContextFromSpan(overrides.span);

  return {
    traceparent: overrides.traceparent ?? event.traceparent,
    tracestate: overrides.tracestate ?? event.tracestate,
  };
};

/**
 * An existing event with the fields you replace, reporting an invalid result
 * rather than throwing.
 *
 * No contract is involved: a clone is the event it was given, so any event may
 * be cloned. Everything you do not replace is copied, `id` and `time`
 * included — a clone sent alongside its source needs a new `id`, consumers
 * deduplicating on that field alone. Nothing is derived: a clone is not a
 * child of its source, and `parentid`, `initid` and `depth` come across as
 * they stand.
 *
 * Trace context takes a replacement `span` first, then a replacement
 * `traceparent` or `tracestate` field by field, then the cloned event's own. A
 * `span` replaces both, so a span carrying no trace state leaves the clone
 * with none.
 *
 * A replacement that breaks a structural rule of an event comes back as an
 * error naming every rule that broke.
 *
 * @example
 * const attempt = tryCloneArvoEvent(emitted, { to: 'com.audit.log' });
 * if (attempt.ok) send(attempt.value);
 * else attempt.error.issues.forEach((issue) => log(issue.path, issue.message));
 */
export const tryCloneArvoEvent = <
  T extends string,
  D extends Record<string, any>,
>(
  event: ArvoEvent<T, D>,
  overrides: Partial<ArvoEventParam<T, D>> = {},
): Result<ArvoEvent<T, D>, ArvoEventValidationError> => {
  const { span: _span, ...replaced } = overrides as {
    span?: Span | SpanContext;
  };

  // An event holds `null` where its input spells absence, and normalization
  // accepts either, so the fields cross over as they stand.
  return tryCreateArvoEvent<T, D>({
    ...event,
    ...replaced,
    ...traceOf(event, overrides),
  } as Parameters<typeof tryCreateArvoEvent<T, D>>[0]);
};

/**
 * An existing event with the fields you replace, throwing if the result would
 * be invalid.
 *
 * No contract is involved: a clone is the event it was given, so any event may
 * be cloned. Everything you do not replace is copied, `id` and `time`
 * included — a clone sent alongside its source needs a new `id`, consumers
 * deduplicating on that field alone. Nothing is derived: a clone is not a
 * child of its source, and `parentid`, `initid` and `depth` come across as
 * they stand.
 *
 * Trace context takes a replacement `span` first, then a replacement
 * `traceparent` or `tracestate` field by field, then the cloned event's own. A
 * `span` replaces both, so a span carrying no trace state leaves the clone
 * with none.
 *
 * @throws {ArvoEventValidationError} If a replacement breaks a structural rule
 * of an event. The message names every rule that broke.
 *
 * @example
 * const routed = cloneArvoEvent(emitted, { to: 'com.audit.log', id: freshId });
 * routed.data;  // the source event's payload, typed as it was
 */
export const cloneArvoEvent = <T extends string, D extends Record<string, any>>(
  event: ArvoEvent<T, D>,
  overrides?: Partial<ArvoEventParam<T, D>>,
): ArvoEvent<T, D> => {
  const cloned = tryCloneArvoEvent(event, overrides);
  if (cloned.ok) return cloned.value;
  throw cloned.error;
};
