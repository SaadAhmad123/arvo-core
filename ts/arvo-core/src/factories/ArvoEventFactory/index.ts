import { err, ok } from 'neverthrow';
import { ArvoContractValidationError } from '../../ArvoContract/errors.js';
import { VersionedArvoContract } from '../../ArvoContract/versioned/index.js';
import { fromNeverthrow } from '../../result.js';
import type { Result } from '../../types.js';
import { ErrorIssue } from '../../utils/error-issue.js';
import { ArvoEventFactory } from './factory.js';
import type { ContractEventOptions } from './types.js';

export { ArvoEventFactory } from './factory.js';

/**
 * A factory for the events one version of a contract declares, reporting an
 * unusable contract rather than throwing.
 *
 * Bind it once and the version stops being an argument at every call site. The
 * factory carries the version it was given, so each event it builds takes its
 * `type` and `dataschema` from that contract and has its payload checked
 * against that version's own schema.
 *
 * Anything that is not a version of a contract comes back as an error — a
 * possibility only for a caller without types, since the parameter admits
 * nothing else.
 *
 * For an event no contract declares, use `tryCreateArvoEvent`. To copy one,
 * use `tryCloneArvoEvent`.
 *
 * @param contract - The version to build events for, reached as
 * `contract.versions['1.0.0']`.
 * @param options - The sources an `ArvoDomain` symbol may name, bound once
 * for every event this factory builds. `triggeringEvent` is the event that
 * arrived, so a factory given one belongs to a single invocation.
 *
 * @example
 * const built = tryCreateArvoEventFactory(contract.versions['1.0.0']);
 * if (!built.ok) return built.error;
 *
 * const requested = built.value.createInput({
 *   source: 'com.web.checkout',
 *   subject: 'order-42',
 *   data: { items: ['book'] },
 * });
 */
export const tryCreateArvoEventFactory = <V extends VersionedArvoContract>(
  contract: V,
  options?: ContractEventOptions,
): Result<ArvoEventFactory<V>, ArvoContractValidationError> => {
  if (!(contract instanceof VersionedArvoContract)) {
    return fromNeverthrow(
      err(
        new ArvoContractValidationError([
          new ErrorIssue({
            path: 'contract',
            message: 'must be a version of a contract',
            received: contract,
          }),
        ]),
      ),
    );
  }

  return fromNeverthrow(ok(new ArvoEventFactory(contract, options)));
};

/**
 * A factory for the events one version of a contract declares.
 *
 * Bind it once and the version stops being an argument at every call site. The
 * factory carries the version it was given, so each event it builds takes its
 * `type` and `dataschema` from that contract and has its payload checked
 * against that version's own schema.
 *
 * For an event no contract declares, use `createArvoEvent`. To copy one, use
 * `cloneArvoEvent`.
 *
 * @param contract - The version to build events for, reached as
 * `contract.versions['1.0.0']`.
 * @param options - The sources an `ArvoDomain` symbol may name, bound once
 * for every event this factory builds. `triggeringEvent` is the event that
 * arrived, so a factory given one belongs to a single invocation.
 *
 * @throws {ArvoContractValidationError} If `contract` is not a version of a
 * contract — reachable only from a caller without types.
 *
 * @example
 * const orders = createArvoEventFactory(contract.versions['1.0.0']);
 *
 * const requested = orders.createInput({
 *   source: 'com.web.checkout',
 *   subject: 'order-42',
 *   data: { items: ['book'] },
 * });
 *
 * const failed = orders.createError({
 *   source: 'com.order.service',
 *   subject: requested.subject,
 *   error: caught,
 * });
 */
export const createArvoEventFactory = <V extends VersionedArvoContract>(
  contract: V,
  options?: ContractEventOptions,
): ArvoEventFactory<V> => {
  const built = tryCreateArvoEventFactory(contract, options);
  if (built.ok) return built.value;
  throw built.error;
};
