import type { Span, SpanContext } from '@opentelemetry/api';
import type { FlatMap, JSONObject } from '../types.js';

/** The eighteen fields of an ArvoEvent, defaulted and structurally valid. */
export type ArvoEventFields = {
  id: string;
  parentid: string | null;
  initid: string | null;
  subject: string;
  executionid: string;
  category: string | null;
  depth: number;
  source: string;
  to: string | null;
  domain: string | null;
  type: string;
  data: JSONObject;
  dataschema: string;
  baggage: FlatMap;
  time: string;
  traceparent: string | null;
  tracestate: string | null;
  executionunits: number | null;
};

/** Options accepted when constructing an {@link ArvoEvent} or parsing one. */
export type ArvoEventValidationOptions = {
  /**
   * Skips the recursive walk of `data` and `baggage` — and the freeze that
   * rides with it — for input already known to be well formed. Field and
   * cross-field rules still run regardless.
   *
   * Two consequences. A payload holding something the walk would have
   * rejected, such as a non-finite number, is admitted here and fails later
   * at serialization instead. And `data` is passed through as given rather
   * than normalized, so a key whose value is `undefined` survives, where the
   * walk would have dropped it.
   */
  skipPayloadValidation?: boolean;
};

/**
 * Input shape for constructing an {@link ArvoEvent}. `subject`, `source`,
 * `type`, `data`, and `dataschema` are required; every other field is
 * defaulted or derived by the constructor when omitted.
 *
 * @template T - The literal string type of the event's `type` field.
 * @template D - The shape of the event's JSON-serializable `data` payload.
 */
export type ArvoEventParam<
  T extends string = string,
  D extends Record<string, any> = Record<string, any>,
> = {
  /** Identity/deduplication key. Defaults to a random UUID when omitted. */
  id?: string;
  /**
   * The `id` of the event that directly caused this one. Defaults to `null`
   * when omitted, marking a root event.
   */
  parentid?: string;
  /**
   * The `id` of the request this event answers. Required, and only
   * meaningful, on a completion. Defaults to `null` when omitted.
   */
  initid?: string;
  /** The workflow this event belongs to. Required. */
  subject: string;
  /**
   * This event's execution identity. Defaults to `subject` when omitted,
   * which is correct for a root event.
   */
  executionid?: string;
  /**
   * This event's execution role. `io.arvo.init` and `io.arvo.complete` are
   * recognized; any other value, including a domain's own, carries no
   * ecosystem meaning. Defaults to `null` when omitted.
   */
  category?: string;
  /**
   * This event's nesting level, measured from the root. Must be a
   * non-negative integer. Defaults to `0` when omitted.
   */
  depth?: number;
  /**
   * Identifies the producer of this event. Required.
   *
   * Must be a non-empty RFC 3986 URI-reference. A hierarchical path
   * (`api/users`), a bare token (`order-service`), and an absolute URI are
   * all valid; whitespace and raw non-ASCII characters are not — percent-encode
   * them first if your identifier needs to carry either. This is stricter
   * than every other string field on ArvoEvent, which otherwise accept any
   * Unicode text outside a narrow set of control characters.
   *
   * Must also already be in canonical form: a lowercase scheme/host, no
   * unresolved `.`/`..` path segment, and no percent-encoding that could be
   * un-encoded or uppercased instead. A value that is technically a valid
   * URI-reference but not yet canonical — `HTTPS://...`, `a/./b` — is
   * rejected rather than normalized for you. Checked via the
   * [`fast-uri`](https://www.npmjs.com/package/fast-uri) package: a value
   * round-trips through its `parse`/`serialize` unchanged only if it was
   * already canonical.
   */
  source: string;
  /** The intended recipient of this event. Defaults to `null` when omitted. */
  to?: string;
  /**
   * Marks an event that cannot be fulfilled where it is and must be lifted
   * to another lattice, a human participant, or an external system. `null`
   * — the default — means ordinary traffic.
   */
  domain?: string;
  /** This event's type name. Required. */
  type: T;
  /** This event's JSON-serializable payload. Required. */
  data: D;
  /**
   * The exact contract URI and version this event relates to. Required.
   *
   * Must be a non-empty RFC 3986 URI-reference in canonical form — the same
   * rule `source` follows (see its TSDoc for what "canonical" requires),
   * including a fragment-only reference such as `#/contracts/user`.
   *
   * Where no contract governs the event yet, use `unknown/0.0.0` rather than
   * inventing a URI. It is greppable and cannot be mistaken for a real
   * contract reference.
   */
  dataschema: string;
  /**
   * Ambient context carried unchanged across the entire workflow: a flat map
   * of scalars, with no nesting at any depth. Written once, on the root
   * event — a later event may only copy it forward, never add, remove, or
   * change a key. Defaults to an empty object when omitted.
   */
  baggage?: FlatMap;
  /**
   * RFC 3339 timestamp of when the event occurred, with a UTC offset.
   * Descriptive only — never used to establish ordering. Defaults to the
   * current time when omitted.
   */
  time?: string;
  /**
   * An opaque numeric value whose meaning is defined entirely by the
   * emitting handler. Any finite number is accepted, with no constraint on
   * sign or magnitude. Defaults to `null` when omitted.
   */
  executionunits?: number;
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
