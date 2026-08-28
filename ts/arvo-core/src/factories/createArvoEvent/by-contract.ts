import { err } from 'neverthrow';
import type * as z from 'zod/v4/core';
import type { VersionedArvoContract } from '../../ArvoContract/versioned/index.js';
import { ArvoEventValidationError } from '../../ArvoEvent/errors.js';
import type { ArvoEvent } from '../../ArvoEvent/index.js';
import { fromNeverthrow } from '../../result.js';
import type { Result } from '../../types.js';
import { ErrorIssue } from '../../utils/error-issue.js';
import { domainFor } from './domain.js';
import { checkPayload } from './payload.js';
import { raw } from './raw.js';
import type { ContractEventOptions, ContractEventParam } from './types.js';

/**
 * One of the events a version emits, built from that version.
 *
 * `type` is one of the version's `emits` keys; anything else is a compile
 * error. That key's schema checks the payload, and what the check produces is
 * what the event carries.
 *
 * The handler error is not reachable here. It is derived from the contract's
 * `type` rather than declared, so it is not an entry of `emits` — build it
 * with the handler error factory.
 *
 * `dataschema` comes from the contract. `domain` defaults to the contract's
 * own; pass a string to set it outright, or one of `ArvoDomain`'s symbols to
 * read it from somewhere else, supplying that symbol's source in
 * `options.domainCtx`.
 */
export const byContract = <
  V extends VersionedArvoContract,
  E extends keyof V['emits'] & string,
>(
  contract: V,
  param: { type: E } & ContractEventParam<V['emits'][E]>,
  options?: ContractEventOptions,
): Result<ArvoEvent<E, z.output<V['emits'][E]>>, ArvoEventValidationError> => {
  // Indexing a generic's own property does not carry the mapped type: here
  // `emits` is only known to hold schemas, so the lookup widens to one.
  // Restated, because the value fetched is exactly `E`'s schema.
  const schema = contract.emits[param.type] as V['emits'][E] | undefined;

  // Unreachable from TypeScript, which rejects a `type` this version does not
  // declare. Reachable from JavaScript, and from anything that casts — and
  // without this the missing schema reaches `safeParse`, which throws, out of
  // a function whose whole purpose is to report rather than throw.
  if (schema === undefined) {
    return fromNeverthrow(
      err(
        new ArvoEventValidationError([
          new ErrorIssue({
            path: 'type',
            message: `must be one of this version's emits: ${Object.keys(contract.emits).join(', ') || 'it declares none'}`,
            received: param.type,
          }),
        ]),
      ),
    );
  }

  const checked = checkPayload<V['emits'][E]>(
    schema,
    param.data,
    `emits[${param.type}]`,
  );

  if (!checked.ok) return fromNeverthrow(err(checked.error));

  // `type` stays in `fields`: it is the event's own, and the caller chose it.
  const { data: _data, domain, ...fields } = param;

  return raw<E, z.output<V['emits'][E]>>({
    ...fields,
    dataschema: contract.dataschema,
    domain: domainFor(contract, domain, options),
    data: checked.value,
  });
};
