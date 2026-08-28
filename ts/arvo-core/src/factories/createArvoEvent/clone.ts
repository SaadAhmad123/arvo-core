import type { Span, SpanContext } from '@opentelemetry/api';
import type { ArvoEventValidationError } from '../../ArvoEvent/errors.js';
import type { ArvoEvent } from '../../ArvoEvent/index.js';
import { traceContextFromSpan } from '../../ArvoEvent/opentelemetry.js';
import type { ArvoEventParam } from '../../ArvoEvent/types.js';
import type { Result } from '../../types.js';
import { raw } from './raw.js';

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
 * An event with the same field values as an existing one, and whatever the
 * overrides replace.
 *
 * Every field is copied, `id` and `time` included — a clone sent alongside its
 * source needs a new `id`, since consumers deduplicate on it. Nothing is
 * derived: a clone is not a child of its source, and `parentid`, `initid` and
 * `depth` come across as they stand.
 *
 * Trace context takes an overridden `span` first, then an overridden
 * `traceparent` or `tracestate` field by field, then the cloned event's own. A
 * `span` replaces both, so a span carrying no trace state leaves the clone
 * with none.
 */
export const clone = <T extends string, D extends Record<string, any>>(
  event: ArvoEvent<T, D>,
  overrides: Partial<ArvoEventParam<T, D>> = {},
): Result<ArvoEvent<T, D>, ArvoEventValidationError> => {
  const { span: _span, ...replaced } = overrides as {
    span?: Span | SpanContext;
  };

  // An event holds `null` where its input spells absence, and normalization
  // accepts either, so the fields cross over as they stand.
  return raw<T, D>({
    ...event,
    ...replaced,
    ...traceOf(event, overrides),
  } as Parameters<typeof raw<T, D>>[0]);
};
