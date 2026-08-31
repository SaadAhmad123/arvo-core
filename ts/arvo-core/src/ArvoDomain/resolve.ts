import { ArvoDomain } from './index.js';
import type { ArvoDomainContext, ArvoDomainInput } from './types.js';

/**
 * Reads a `domain` from wherever a caller pointed.
 *
 * A string is returned as it stands. A symbol is read from its own source in
 * {@link ArvoDomainContext}, and `null` is a real answer rather than a
 * failure: a contract whose `domain` is `null`, asked for its domain, has
 * answered. A symbol whose source was not supplied reads as `null` too.
 *
 * Internal to this package. Symbols are public so a caller can name one; what
 * a symbol means is decided here, and by whatever builds the event.
 */
export const resolveEventDomain = (
  domain: ArvoDomainInput,
  context: ArvoDomainContext,
): string | null => {
  if (typeof domain === 'string') return domain;

  switch (domain) {
    case ArvoDomain.LOCAL:
      return null;
    case ArvoDomain.FROM_EVENT_CONTRACT:
      return context.eventContract.domain ?? null;
    case ArvoDomain.FROM_SELF_CONTRACT:
      return context.selfContract?.domain ?? null;
    case ArvoDomain.FROM_TRIGGERING_EVENT:
      return context.triggeringEvent?.domain ?? null;
  }
};
