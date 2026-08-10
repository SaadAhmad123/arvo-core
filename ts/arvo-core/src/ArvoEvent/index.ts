import type { Span, SpanContext } from '@opentelemetry/api';
import { err, ok } from 'neverthrow';
import { fromNeverthrow } from '../result.js';
import type { FlatMap, Result } from '../types.js';
import { ArvoEventValidationError } from './errors.js';
import { traceContextFromSpan } from './opentelemetry.js';
import type { ArvoEventParam, ArvoEventValidationOptions } from './types.js';
import { validateArvoEvent } from './validator.js';

/**
 * An immutable, structurally valid event exchanged between Arvo nodes.
 *
 * Validation runs synchronously in the constructor; input that fails any
 * structural rule throws {@link ArvoEventValidationError} immediately, and
 * the instance is frozen once constructed.
 *
 * @example
 * ```typescript
 * const event = new ArvoEvent({
 *   source: 'com.service.my',
 *   subject: 'order-123',
 *   type: 'order.created',
 *   dataschema: 'https://schemas.example.com/order.created/1.0.0',
 *   data: { orderId: '123' },
 * });
 * ```
 */
export class ArvoEvent<
  T extends string = string,
  D extends Record<string, any> = Record<string, any>,
> {
  readonly id: string;
  readonly parentid: string | null;
  readonly initid: string | null;
  readonly subject: string;
  readonly executionid: string;
  readonly category: string | null;
  readonly depth: number;
  readonly source: string;
  readonly to: string | null;
  readonly domain: string | null;
  readonly type: T;
  /** JSON-serializable. Every number anywhere within it must be finite. */
  readonly data: D;
  readonly dataschema: string;
  /** A flat map of scalars. Every number within it must be finite. */
  readonly baggage: FlatMap;
  readonly time: string;
  readonly traceparent: string | null;
  readonly tracestate: string | null;
  /** Must be finite. No constraint is placed on its sign or magnitude. */
  readonly executionunits: number | null;

  /**
   * @param param - The event's field values. See {@link ArvoEventParam} for
   * defaults and per-field rules.
   * @param options - See {@link ArvoEventValidationOptions}.
   * @throws {ArvoEventValidationError} If `param` fails structural validation.
   */
  constructor(
    param: ArvoEventParam<T, D>,
    options?: ArvoEventValidationOptions,
  ) {
    // Destructuring a non-object — a string, an array, a number — spreads
    // its indexed characters/elements as if they were field names rather
    // than producing anything meaningful. Only extract `span` when `param`
    // is genuinely a plain-enough object; anything else is passed through
    // unchanged so validateArvoEvent's own top-level guard rejects it
    // cleanly, with one issue naming what it actually is.
    let raw: unknown = param;

    if (param !== null && typeof param === 'object' && !Array.isArray(param)) {
      const traceInput = param as ArvoEventParam<T, D> & {
        span?: Span | SpanContext;
      };
      const { span, ...rest } = traceInput;

      const withTrace: Record<string, unknown> = { ...rest };
      if (span) {
        const trace = traceContextFromSpan(span);
        withTrace.traceparent = trace.traceparent;
        withTrace.tracestate = trace.tracestate;
      }
      raw = withTrace;
    }

    const result = validateArvoEvent(raw, options);

    if (result.issues.length > 0) {
      throw new ArvoEventValidationError(result.issues);
    }

    const fields = result.value;
    this.id = fields.id;
    this.parentid = fields.parentid;
    this.initid = fields.initid;
    this.subject = fields.subject;
    this.executionid = fields.executionid;
    this.category = fields.category;
    this.depth = fields.depth;
    this.source = fields.source;
    this.to = fields.to;
    this.domain = fields.domain;
    this.type = fields.type as T;
    this.data = fields.data as D;
    this.dataschema = fields.dataschema;
    this.baggage = fields.baggage;
    this.time = fields.time;
    this.traceparent = fields.traceparent;
    this.tracestate = fields.tracestate;
    this.executionunits = fields.executionunits;

    Object.freeze(this);
  }

  /**
   * Constructs an event, throwing on structural failure.
   *
   * @throws {ArvoEventValidationError} If `param` fails structural validation.
   */
  static parse<
    T extends string = string,
    D extends Record<string, any> = Record<string, any>,
  >(param: unknown, options?: ArvoEventValidationOptions): ArvoEvent<T, D> {
    const result = ArvoEvent.tryParse<T, D>(param, options);
    if (result.ok) return result.value;
    throw result.error;
  }

  /**
   * Constructs an event and reports the outcome as a value rather than
   * throwing — for an event arriving from replay, a fixture, or a foreign
   * producer, where an exception is the wrong control flow.
   *
   * This checks structure only. It is not a wire-format or CloudEvent
   * decoder.
   */
  static tryParse<
    T extends string = string,
    D extends Record<string, any> = Record<string, any>,
  >(
    input: unknown,
    options?: ArvoEventValidationOptions,
  ): Result<ArvoEvent<T, D>, ArvoEventValidationError> {
    try {
      return fromNeverthrow(
        ok(new ArvoEvent<T, D>(input as ArvoEventParam<T, D>, options)),
      );
    } catch (error) {
      if (error instanceof ArvoEventValidationError) {
        return fromNeverthrow(err(error));
      }
      throw error;
    }
  }
}
