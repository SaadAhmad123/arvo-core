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
import type { ContractEventOptions, ContractEventParam } from './types.js';

/**
 * The event a version accepts, built from that version.
 *
 * `type` and `dataschema` come from the contract, so neither is passed. The
 * payload is checked against the version's `accepts`, and what that check
 * produces is what the event carries — so a value the schema declares a
 * default for is present even where the caller omitted it.
 *
 * `domain` defaults to the contract's own. Pass a string to set it outright,
 * or one of `ArvoDomain`'s symbols to read it from somewhere else, supplying
 * that symbol's source in `options.domainCtx`.
 */
export const forContract = <V extends VersionedArvoContract>(
  contract: V,
  param: ContractEventParam<V['accepts']>,
  options?: ContractEventOptions,
): Result<
  ArvoEvent<V['type'], z.output<V['accepts']>>,
  ArvoEventValidationError
> => {
  const checked = checkPayload<V['accepts']>(
    contract.accepts,
    param.data,
    'accepts',
  );
  if (!checked.ok) return fromNeverthrow(err(checked.error));
  const { data: _data, domain, ...fields } = param;
  return raw<V['type'], z.output<V['accepts']>>({
    to: fields.to ?? contract.type ?? undefined,
    ...fields,
    type: contract.type,
    dataschema: contract.dataschema,
    domain: domainFor(contract, domain, options),
    data: checked.value,
  });
};
