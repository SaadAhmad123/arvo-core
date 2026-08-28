import type * as z from 'zod/v4/core';
import type {
  ArvoDomainContext,
  ArvoDomainInput,
} from '../../ArvoDomain/types.js';
import type { ArvoEventParam } from '../../ArvoEvent/types.js';

/**
 * The fields a contract supplies, which a caller therefore never passes.
 *
 * `domain` is here because a contract-aware factory accepts a wider input for
 * it than an event does — a value, or one of `ArvoDomain`'s symbols.
 */
export type SuppliedByContract = 'type' | 'dataschema' | 'data' | 'domain';

/**
 * What a contract-aware factory accepts beyond the event's own fields.
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
 * `domain` defaults to the contract's own. Pass a string to set it outright,
 * or one of `ArvoDomain`'s symbols to read it from somewhere else.
 */
export type ContractEventParam<S extends z.$ZodType> = Partial<
  Omit<ArvoEventParam, SuppliedByContract>
> & {
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
> & {
  source: string;
  error: Error;
  domain?: ArvoDomainInput;
};
