import { resolveEventDomain } from '../../ArvoDomain/resolve.js';
import type {
  ArvoDomainContext,
  ArvoDomainInput,
} from '../../ArvoDomain/types.js';
import type { ContractEventOptions } from './types.js';

/**
 * The `domain` a contract-aware factory builds an event with.
 *
 * Omitted means none: nothing is inherited, and a caller who wants the
 * contract's own asks for it with `ArvoDomain.FROM_EVENT_CONTRACT`. A string
 * is used as it stands, and a symbol is read from its source.
 *
 * A resolved `null` becomes omission, an event's input spelling absence that
 * way. The guard is on `undefined` rather than falsiness, so an empty string
 * reaches the resolver as the value it is.
 */
export const domainFor = (
  contract: ArvoDomainContext['eventContract'],
  domain?: ArvoDomainInput,
  options?: ContractEventOptions,
): string | undefined => {
  if (domain === undefined) return undefined;
  return (
    resolveEventDomain(domain, {
      ...options?.domainCtx,
      eventContract: contract,
    }) ?? undefined
  );
};
