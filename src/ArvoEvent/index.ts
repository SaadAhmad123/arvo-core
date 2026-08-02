import type { Span, SpanContext } from '@opentelemetry/api';
import type { FlatMap } from '../types.js';
import type { ArvoEventValidationIssue } from './errors.js';
import { ArvoEventValidationError } from './errors.js';
import { traceContextFromSpan } from './opentelemetry.js';
import type { ArvoEventParam } from './types.js';
import {
  type ArvoEventValidationOptions,
  validateArvoEvent,
} from './validator.js';

/**
 * The outcome of {@link ArvoEvent.safeParse}: the event on success, or every
 * structural rule broken on failure.
 */
export type ArvoEventParseResult<
  T extends string = string,
  D extends Record<string, any> = Record<string, any>,
> =
  | { success: true; event: ArvoEvent<T, D> }
  | { success: false; issues: readonly ArvoEventValidationIssue[] };

/**
 * An immutable, structurally valid event exchanged between Arvo nodes.
 *
 * Validation runs synchronously in the constructor; input that fails any
 * structural rule throws {@link ArvoEventValidationError} immediately, and
 * the instance is frozen once constructed.
 *
 * @see docs/adr/001-arvoevent-structure.md for the full definition of every
 * field, its default, and the rules it must satisfy.
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
    const traceInput = param as ArvoEventParam<T, D> & {
      span?: Span | SpanContext;
    };
    const { span, ...rest } = traceInput;

    const raw: Record<string, unknown> = { ...rest };
    if (span) {
      const trace = traceContextFromSpan(span);
      raw.traceparent = trace.traceparent;
      raw.tracestate = trace.tracestate;
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
   * Validates plain data against every structural rule and reports the
   * outcome rather than throwing — for an event arriving from replay, a
   * fixture, or a foreign producer, where an exception is the wrong control
   * flow.
   *
   * This checks structure only. It is not a wire-format or CloudEvent
   * decoder.
   */
  static safeParse<
    T extends string = string,
    D extends Record<string, any> = Record<string, any>,
  >(input: unknown): ArvoEventParseResult<T, D> {
    const result = validateArvoEvent(input);

    if (result.issues.length > 0) {
      return { success: false, issues: Object.freeze([...result.issues]) };
    }

    const event = new ArvoEvent<T, D>(
      result.value as unknown as ArvoEventParam<T, D>,
      { skipPayloadValidation: true },
    );

    return { success: true, event };
  }
}
