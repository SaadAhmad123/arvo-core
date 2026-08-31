import type { Span, SpanContext } from '@opentelemetry/api';
import type * as z from 'zod/v4/core';
import type {
  ArvoDomainContext,
  ArvoDomainInput,
} from '../../ArvoDomain/types.js';
import type { ArvoEventParam } from '../../ArvoEvent/types.js';

/**
 * The fields a contract supplies, which a caller therefore never passes.
 *
 * `domain` is here because a contract-aware factory input a wider input for
 * it than an event does — a value, or one of `ArvoDomain`'s symbols.
 */
export type SuppliedByContract = 'type' | 'dataschema' | 'data' | 'domain';

/**
 * An event's trace context, as its own input spells it: the W3C header pair or
 * a span to derive them from, never both.
 *
 * Restated here because `Omit` collapses it — the two arms share no key, so
 * omitting anything from `ArvoEventParam` drops the whole union.
 */
type TraceContextParam =
  | {
      /** Raw W3C `traceparent`. Mutually exclusive with `span`. */
      traceparent?: string;
      /** Raw W3C `tracestate`. Mutually exclusive with `span`. */
      tracestate?: string;
    }
  | {
      /** A span to derive `traceparent`/`tracestate` from. */
      span?: Span | SpanContext;
    };

/**
 * What a contract-aware factory input beyond the event's own fields.
 *
 * `domainCtx` carries the sources `ArvoDomain`'s symbols read from that a
 * factory cannot know: the contract of whoever is building the event, and the
 * event that caused it. The contract the event is built from is the factory's
 * own first argument, so it is not repeated here.
 *
 * These are never part of the event. A symbol is resolved to a value before
 * anything is built, and a symbol whose source is absent reads as `null`.
 */
export type ContractEventOptions = {
  domainCtx?: Pick<ArvoDomainContext, 'selfContract' | 'triggeringEvent'>;
};

/**
 * The fields a caller passes when a contract supplies the rest.
 *
 * `data` is the schema's input side: what a caller may write. What the event
 * ends up holding is the schema's output, which differs wherever the schema
 * declares a default or a transform.
 *
 * `domain` omitted means the event has no domain. Pass a string to set one
 * outright, or one of `ArvoDomain`'s symbols to read one from somewhere —
 * `FROM_EVENT_CONTRACT` for the contract's own.
 */
export type ContractEventParam<S extends z.$ZodType> = Partial<
  Omit<ArvoEventParam, SuppliedByContract>
> &
  TraceContextParam & {
    source: string;
    data: z.input<S>;
    domain?: ArvoDomainInput;
  };

/**
 * The fields a caller passes for a handler error event.
 *
 * `data` is absent by design: the payload is read from `error`.
 */
export type ErrorEventParam = Partial<
  Omit<ArvoEventParam, SuppliedByContract>
> &
  TraceContextParam & {
    source: string;
    error: Error;
    domain?: ArvoDomainInput;
  };
