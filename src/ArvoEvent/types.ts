import type { Span, SpanContext } from '@opentelemetry/api';
import type { JSONPrimitive } from '../types.js';

/**
 * Input shape for constructing an {@link ArvoEvent}. All fields except
 * `source`, `subject`, `type`, and `data` are optional and are defaulted or
 * derived by the `ArvoEvent` constructor when omitted.
 *
 * @template T - The literal string type of the event's `type` field.
 * @template D - The shape of the event's JSON-serializable `data` payload.
 */
export type ArvoEventParam<
  T extends string = string,
  D extends Record<string, any> = Record<string, any>,
> = {
  /**
   * The event's identity/deduplication key. Defaults to a generated UUID v4
   * (`crypto.randomUUID()`) when omitted.
   */
  id?: string;
  /**
   * The id of the event that directly caused this one, for causal lineage
   * tracking. Defaults to `null` when omitted.
   */
  parentid?: string;
  /** Intended recipient/destination of the event, used for routing. Defaults to `null` when omitted. */
  to?: string;
  /** RFC 3339 timestamp of when the event occurred. Defaults to the current time when omitted. */
  time?: string;
  /** The cost associated with producing this event. Defaults to `null` when omitted. */
  executionunits?: number;
  /** Processing domain used for routing/segregation of the event. Defaults to `null` when omitted. */
  domain?: string;
  /**
   * Loosely-typed, scalar-only metadata that propagates unchanged across an
   * entire workflow, distinct from `data`. Functions like distributed global
   * state shared between handlers: a handler may only read from it and
   * append new keys — existing keys must never be overwritten. Defaults to
   * `{}` when omitted.
   */
  baggage?: Record<string, JSONPrimitive>;
  /**
   * The `subject` of the workflow's originating event. An event is a root
   * event when `rootsubject === subject`. Defaults to `subject` when
   * omitted, marking a root event by default.
   */
  rootsubject?: string;
  /**
   * The non-negative integer "stack depth" of this event within its
   * workflow. Must be `0` for root events (`rootsubject === subject`) and
   * `>= 1` otherwise — enforced by `ArvoEvent`'s validation. Defaults to `0`
   * when omitted.
   */
  depth?: number;
  /** URI identifying the schema that `data` conforms to. Defaults to `null` when omitted. */
  dataschema?: string;
  /** Identifies the producer of the event. Required. */
  source: string;
  /** Identifies the specific process/entity this event belongs to. Required. */
  subject: string;
  /** The event's type name. Required. */
  type: T;
  /** The event's JSON-serializable payload. Required. */
  data: D;
} & (
  | {
      /** Raw W3C `traceparent` header string. Mutually exclusive with `span` — prefer `span` when you have one, since it derives this for you. */
      traceparent?: string;
      /** Raw W3C `tracestate` header string. Mutually exclusive with `span`. */
      tracestate?: string;
    }
  | {
      /**
       * An OpenTelemetry `Span` or `SpanContext` to derive `traceparent`/
       * `tracestate` from automatically, so you don't have to hand-format
       * the W3C trace-context strings yourself. Takes priority over
       * `traceparent`/`tracestate` if both are somehow provided.
       */
      span?: Span | SpanContext;
    }
);
