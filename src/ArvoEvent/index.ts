import type { Span, SpanContext } from '@opentelemetry/api';
import { z } from 'zod';
import type { JSONPrimitive, NoKnownKeys } from '../types.js';
import { createTimestamp } from '../utils.js';
import { ArvoEventValidationError } from './errors.js';
import { traceContextFromSpan } from './opentelemetry.js';
import type { ArvoEventParam } from './types.js';
import { ArvoEventValidationSchema } from './validator.js';

/**
 * An immutable, validated data carrier representing a single event within an
 * Arvo workflow. Semantically similar to a CloudEvent, but does not fully
 * depend on the CloudEvents spec — wire-format conversion is handled by a
 * separate transformer, not by `ArvoEvent` itself.
 *
 * Validation runs synchronously in the constructor; an invalid `param`
 * throws {@link ArvoEventValidationError} immediately.
 *
 * @example
 * ```typescript
 * const event = new ArvoEvent({
 *   source: 'com.service.my',
 *   subject: 'order-123',
 *   type: 'order.created',
 *   data: { orderId: '123' },
 * });
 * ```
 */
export class ArvoEvent<
  T extends string = string,
  D extends Record<string, any> = Record<string, any>,
> {
  /** Identity/deduplication key for this event. Generated via `crypto.randomUUID()` when not provided. */
  readonly id: string;
  /** The id of the event that directly caused this one, or `null` if none was provided. */
  readonly parentid: string | null;
  /** Intended recipient/destination of the event, used for routing, or `null` if not provided. */
  readonly to: string | null;
  /** RFC 3339 timestamp of when the event occurred. */
  readonly time: string;
  /** The cost associated with producing this event, or `null` if not provided. */
  readonly executionunits: number | null;
  /** Processing domain used for routing/segregation, or `null` if not provided. */
  readonly domain: string | null;
  /** W3C `traceparent` header string, either passed directly or derived from a `Span`/`SpanContext`, or `null`. */
  readonly traceparent: string | null;
  /** W3C `tracestate` header string, either passed directly or derived from a `Span`/`SpanContext`, or `null`. */
  readonly tracestate: string | null;
  /**
   * Scalar-only metadata that propagates unchanged across the whole
   * workflow, distinct from `data`. Acts as distributed global state shared
   * between handlers — see {@link ArvoEventParam.baggage}.
   */
  readonly baggage: Record<string, JSONPrimitive>;
  /**
   * The `subject` of the workflow's originating event. This event is a root
   * event when `rootsubject === subject`.
   */
  readonly rootsubject: string;
  /** URI identifying the schema that `data` conforms to, or `null` if not provided. */
  readonly dataschema: string | null;
  /**
   * The non-negative integer "stack depth" of this event within its
   * workflow. Always `0` for root events (`rootsubject === subject`) and
   * `>= 1` otherwise.
   */
  readonly depth: number;
  /** Identifies the producer of the event. */
  readonly source: string;
  /** Identifies the specific process/entity this event belongs to. */
  readonly subject: string;
  /** The event's type name. */
  readonly type: T;
  /** The event's JSON-serializable payload. */
  readonly data: D;
  /**
   * Loosely-typed CloudEvent-style extension data. Guaranteed at the type
   * level to never collide with any of `ArvoEvent`'s own known field names
   * (see {@link NoKnownKeys}).
   */
  readonly extensions: Record<string, JSONPrimitive>;

  /**
   * @param param - The event's field values. See {@link ArvoEventParam} for
   * defaults and per-field constraints.
   * @param extensions - Optional CloudEvent-style extension data. Keys
   * colliding with a known `ArvoEvent` field are rejected both at the type
   * level and at runtime.
   * @throws {ArvoEventValidationError} If `param`/`extensions` fail
   * validation, or if `data` is not JSON-serializable.
   */
  constructor(
    param: ArvoEventParam<T, D>,
    extensions?: NoKnownKeys<
      Record<string, JSONPrimitive>,
      keyof ArvoEventParam<string, any>
    >,
  ) {
    this.extensions = extensions ?? {};
    this.id = param.id ?? crypto.randomUUID();
    this.parentid = param.parentid ?? null;
    this.to = param.to ?? null;
    this.time = param.time ?? createTimestamp();
    this.executionunits = param.executionunits ?? null;
    this.domain = param.domain ?? null;
    this.baggage = param.baggage ?? {};
    this.rootsubject = param.rootsubject ?? param.subject;
    this.depth = param.depth ?? 0;
    this.dataschema = param.dataschema ?? null;
    this.source = param.source;
    this.subject = param.subject;
    this.type = param.type;
    this.data = param.data;

    const traceInput = param as {
      traceparent?: string;
      tracestate?: string;
      span?: Span | SpanContext;
    };
    if (traceInput.span) {
      const trace = traceContextFromSpan(traceInput.span);
      this.traceparent = trace.traceparent;
      this.tracestate = trace.tracestate;
    } else {
      this.traceparent = traceInput.traceparent ?? null;
      this.tracestate = traceInput.tracestate ?? null;
    }

    this.validate();
  }

  /**
   * Validates the fully-constructed event against {@link ArvoEventValidationSchema}
   * and confirms `data` is JSON-serializable.
   * @throws {ArvoEventValidationError} On the first validation failure found.
   */
  private validate() {
    const result = ArvoEventValidationSchema.safeParse(this);
    if (!result.success) {
      throw new ArvoEventValidationError(z.prettifyError(result.error), {
        cause: result.error,
      });
    }
    try {
      JSON.stringify(this.data);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new ArvoEventValidationError(
        `ArvoEvent data must be JSON serializable: ${reason}`,
        { cause: error },
      );
    }
  }
}
