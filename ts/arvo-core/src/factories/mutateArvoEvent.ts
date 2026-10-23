import type { Span, SpanContext } from '@opentelemetry/api';
import { trace } from '@opentelemetry/api';
import type { ArvoEventValidationError } from '../ArvoEvent/errors.js';
import { ArvoEvent } from '../ArvoEvent/index.js';
import {
  type ArvoEventTraceContext,
  spanContextOf,
  traceContextFromSpan,
} from '../ArvoEvent/opentelemetry.js';
import type { ArvoEventFields, ArvoEventParam } from '../ArvoEvent/types.js';
import type { Result } from '../types.js';

/**
 * The fields to replace on an existing event: any field an event is built
 * from, in that same shape. A field given as `undefined` replaces nothing.
 *
 * For code built on `arvo-core` that carries events between a producer and
 * a consumer. An event an executor or an application emits is built from its
 * contract instead.
 */
export type ArvoEventMutation<
  TType extends string,
  TData extends Record<string, any>,
> = Partial<ArvoEventParam<TType, TData>>;

/** Every field the event holds, named one by one so a change to the event's shape fails here. */
const fieldsOf = (event: ArvoEvent): ArvoEventFields => ({
  id: event.id,
  parentid: event.parentid,
  initid: event.initid,
  subject: event.subject,
  executionid: event.executionid,
  category: event.category,
  depth: event.depth,
  source: event.source,
  to: event.to,
  domain: event.domain,
  type: event.type,
  data: event.data,
  dataschema: event.dataschema,
  baggage: event.baggage,
  time: event.time,
  traceparent: event.traceparent,
  tracestate: event.tracestate,
  executionunits: event.executionunits,
});

/**
 * Both trace headers from a span, or nothing where the span's context carries
 * no valid trace, as one begun with no SDK and nothing to continue does.
 */
const traceHeadersFor = (
  span: Span | SpanContext | undefined,
): ArvoEventTraceContext | Record<never, never> => {
  if (span === undefined) return {};
  const spanContext = spanContextOf(span);
  return trace.isSpanContextValid(spanContext)
    ? traceContextFromSpan(spanContext)
    : {};
};

/**
 * The same event with the fields you replace and every other one carried
 * across, reporting an invalid result rather than throwing. The event you
 * pass is not modified.
 *
 * For code built on `arvo-core` that carries events between a producer and
 * a consumer — a runtime, a mechanism, a framework, a test harness. An event
 * an executor or an application emits is built from its contract instead.
 *
 * Any field may be replaced, alone or with others. Every field not replaced
 * is carried, identity and time included, and nothing is derived: the result
 * is not a descendant of the event. The result keeps the event's type and
 * payload type unless you replace them. A field you give as `undefined`
 * replaces nothing, the same as leaving it out.
 *
 * Trace context takes a replacement `span` first, then a replacement
 * `traceparent` or `tracestate` field by field, then the event's own. A
 * `span` replaces both headers; one whose context carries no valid trace is
 * treated as not given.
 *
 * @example
 * const attempt = tryMutateArvoEvent(event, { to: 'com.audit.log', executionunits: 3 });
 * if (attempt.ok) attempt.value.id === event.id; // true: the same event
 * else attempt.error.issues.forEach((issue) => log(issue.path, issue.message));
 */
export const tryMutateArvoEvent = <
  T extends string,
  D extends Record<string, any>,
  const TType extends string = T,
  TData extends Record<string, any> = D,
>(
  event: ArvoEvent<T, D>,
  mutation: ArvoEventMutation<TType, TData>,
): Result<ArvoEvent<TType, TData>, ArvoEventValidationError> => {
  // `in` narrows the mutation to the member of its union that carries a span.
  const span = 'span' in mutation ? mutation.span : undefined;
  const traceHeaders = traceHeadersFor(span);
  const replacements = Object.fromEntries(
    Object.entries(mutation).filter(
      ([field, replacement]) => field !== 'span' && replacement !== undefined,
    ),
  );

  // The merged fields have no static shape the compiler can tie to the
  // result's type; tryCreateArvoEvent's typed input would need a cast here.
  return ArvoEvent.tryParse<TType, TData>({
    ...fieldsOf(event),
    ...replacements,
    ...traceHeaders,
  });
};

/**
 * The same event with the fields you replace and every other one carried
 * across, throwing if the result would be invalid. The event you pass is not
 * modified.
 *
 * For code built on `arvo-core` that carries events between a producer and
 * a consumer — a runtime, a mechanism, a framework, a test harness. An event
 * an executor or an application emits is built from its contract instead.
 *
 * Identical to {@link tryMutateArvoEvent} in every rule; see it for how
 * fields and trace context are resolved.
 *
 * @throws {ArvoEventValidationError} If a replacement breaks a structural rule
 * of an event. The message names every rule that broke.
 *
 * @example
 * const audited = mutateArvoEvent(event, {
 *   type: 'com_order_audited',
 *   data: { ...event.data, audited: true },
 * });
 * audited.id === event.id;   // true: the same event, with two fields replaced
 * audited.type;              // 'com_order_audited', typed as the literal
 */
export const mutateArvoEvent = <
  T extends string,
  D extends Record<string, any>,
  const TType extends string = T,
  TData extends Record<string, any> = D,
>(
  event: ArvoEvent<T, D>,
  mutation: ArvoEventMutation<TType, TData>,
): ArvoEvent<TType, TData> => {
  const attempt = tryMutateArvoEvent<T, D, TType, TData>(event, mutation);
  if (attempt.ok) return attempt.value;
  throw attempt.error;
};
