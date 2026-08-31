import { err } from 'neverthrow';
import type * as z from 'zod/v4/core';
import type { VersionedArvoContract } from '../../ArvoContract/versioned/index.js';
import { ArvoEventValidationError } from '../../ArvoEvent/errors.js';
import type { ArvoEvent } from '../../ArvoEvent/index.js';
import { fromNeverthrow } from '../../result.js';
import type { Result } from '../../types.js';
import { ErrorIssue } from '../../utils/error-issue.js';
import { tryCreateArvoEvent } from '../createArvoEvent.js';
import { domainFor } from './domain.js';
import { checkPayload } from './payload.js';
import type { ContractEventOptions, ContractEventParam } from './types.js';

/**
 * One of the events a version outputs, built from that version.
 *
 * `type` is one of the version's `outputs` keys; anything else is a compile
 * error. That key's schema checks the payload, and what the check produces is
 * what the event carries.
 *
 * The handler error is not reachable here. It is derived from the contract's
 * `type` rather than declared, so it is not an entry of `outputs` — build it
 * with `.error`.
 *
 * `dataschema` comes from the contract. `to` does not: where an emitted event
 * goes is the caller's to say.
 *
 * `domain` omitted means the event has no domain. Pass a string to set one, or
 * one of `ArvoDomain`'s symbols to read one from somewhere — supplying that
 * symbol's source in `options.domainCtx` where it needs one.
 */
export const buildOutput = <
  V extends VersionedArvoContract,
  E extends keyof V['outputs'] & string,
>(
  contract: V,
  param: { type: E } & ContractEventParam<V['outputs'][E]>,
  options?: ContractEventOptions,
): Result<
  ArvoEvent<E, z.output<V['outputs'][E]>>,
  ArvoEventValidationError
> => {
  // Indexing a generic's own property does not carry the mapped type: here
  // `outputs` is only known to hold schemas, so the lookup widens to one.
  // Restated, because the value fetched is exactly `E`'s schema.
  const schema = contract.outputs[param.type] as V['outputs'][E] | undefined;

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
            message: `must be one of this version's outputs: ${Object.keys(contract.outputs).join(', ') || 'it declares none'}`,
            received: param.type,
          }),
        ]),
      ),
    );
  }

  const checked = checkPayload<V['outputs'][E]>(
    schema,
    param.data,
    `outputs[${param.type}]`,
  );

  if (!checked.ok) return fromNeverthrow(err(checked.error));

  // `type` stays in `fields`: it is the event's own, and the caller chose it.
  const { data: _data, domain, ...fields } = param;

  return tryCreateArvoEvent<E, z.output<V['outputs'][E]>>({
    ...fields,
    dataschema: contract.dataschema,
    domain: domainFor(contract, domain, options),
    data: checked.value,
  });
};
