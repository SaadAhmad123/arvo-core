import { resolveEventDomain } from '../../ArvoDomain/resolve.js';
import type {
  ArvoDomainContext,
  ArvoDomainInput,
} from '../../ArvoDomain/types.js';
import type { ContractEventOptions } from './types.js';

/**
 * The `domain` a contract-aware factory builds an event with.
 *
 * Omitted means the contract's own, which is what a contract carries a
 * `domain` for. A symbol is read from its source; a string is used as it
 * stands.
 *
 * `null` becomes `undefined` on the way out: an event holds `null` for a
 * domain it does not have, and an event's input says the same by omission.
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
