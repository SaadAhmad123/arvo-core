import { err } from 'neverthrow';
import type * as z from 'zod/v4/core';
import type { VersionedArvoContract } from '../../ArvoContract/versioned/index.js';
import type { ArvoEventValidationError } from '../../ArvoEvent/errors.js';
import type { ArvoEvent } from '../../ArvoEvent/index.js';
import { fromNeverthrow } from '../../result.js';
import type { Result } from '../../types.js';
import { domainFor } from './domain.js';
import { checkPayload } from './payload.js';
import { raw } from './raw.js';
import type { ContractEventOptions, ErrorEventParam } from './types.js';

/**
 * A version's handler error event, built from the error itself.
 *
 * The payload is the error read into the three fields every handler error
 * carries, so a caller passes the error rather than assembling that shape.
 *
 * The event's type and its payload shape are both read off the contract's own
 * `handlerError` — the contract already derived them, and deriving them again
 * from its `type` would be a second copy of that rule. `dataschema` comes
 * from the contract too.
 *
 * The payload is checked like any other, though this one is built here rather
 * than supplied. It costs nothing, and it is the only thing standing between a
 * caller who passes something that is not an `Error` and an event carrying a
 * payload no consumer can read.
 *
 * `to` is not defaulted: where an error goes is the caller's to say.
 *
 * `domain` omitted means the event has no domain. Pass a string to set one, or
 * one of `ArvoDomain`'s symbols to read one from somewhere — supplying that
 * symbol's source in `options.domainCtx` where it needs one.
 */
export const handlerError = <V extends VersionedArvoContract>(
  contract: V,
  param: ErrorEventParam,
  options?: ContractEventOptions,
): Result<
  ArvoEvent<V['handlerError']['type'], z.output<V['handlerError']['schema']>>,
  ArvoEventValidationError
> => {
  const { error, domain, ...fields } = param;

  const checked = checkPayload<V['handlerError']['schema']>(
    contract.handlerError.schema,
    {
      error_name: error?.name,
      error_message: error?.message,
      error_stack: error?.stack ?? null,
    },
    'handler error payload',
  );

  if (!checked.ok) return fromNeverthrow(err(checked.error));

  return raw<V['handlerError']['type'], z.output<V['handlerError']['schema']>>({
    ...fields,
    type: contract.handlerError.type,
    dataschema: contract.dataschema,
    domain: domainFor(contract, domain, options),
    data: checked.value,
  });
};
