import { err, ok } from 'neverthrow';
import { ArvoContractValidationError } from '../ArvoContract/errors.js';
import { ArvoContract } from '../ArvoContract/index.js';
import type {
  ArvoContractParam,
  ArvoContractVersionMapParam,
} from '../ArvoContract/types.js';
import { fromNeverthrow } from '../result.js';
import type { Result } from '../types.js';

/**
 * Declares a contract, reporting an invalid declaration rather than throwing.
 *
 * The error names every rule the declaration broke, not just the first. For a
 * declaration you wrote yourself and expect to be valid, `new ArvoContract()`
 * or {@link createArvoContract} says the same thing by throwing.
 *
 * A single version is read from the contract — `contract.versions['1.0.0']` —
 * rather than built, so there is nothing here for one.
 *
 * @param param - The contract's fields. See {@link ArvoContractParam} for
 * defaults and per-field rules. Pass `versions` inline or as an unannotated
 * `const`, so each version keeps its own schema types.
 *
 * @example
 * const declared = tryCreateArvoContract({
 *   type: 'com_order_create',
 *   versions: {
 *     '1.0.0': { accepts: z.object({ items: z.array(z.string()) }), emits: {} },
 *   },
 * });
 * if (declared.ok) declared.value.versions['1.0.0'].dataschema;
 * else declared.error.issues;
 */
export const tryCreateArvoContract = <
  T extends string = string,
  M extends ArvoContractVersionMapParam = ArvoContractVersionMapParam,
>(
  param: ArvoContractParam<T, M>,
): Result<ArvoContract<T, M>, ArvoContractValidationError> => {
  try {
    return fromNeverthrow(ok(new ArvoContract<T, M>(param)));
  } catch (error) {
    if (error instanceof ArvoContractValidationError) {
      return fromNeverthrow(err(error));
    }
    throw error;
  }
};

/**
 * Declares a contract, throwing if the declaration is invalid.
 *
 * Identical to `new ArvoContract()`, in function form. Use
 * {@link tryCreateArvoContract} to handle an invalid declaration as a value
 * instead.
 *
 * A single version is read from the contract — `contract.versions['1.0.0']` —
 * rather than built, so there is nothing here for one.
 *
 * @param param - The contract's fields. See {@link ArvoContractParam} for
 * defaults and per-field rules. Pass `versions` inline or as an unannotated
 * `const`, so each version keeps its own schema types.
 *
 * @throws {ArvoContractValidationError} If the declaration breaks any rule,
 * naming every rule it broke.
 */
export const createArvoContract = <
  T extends string = string,
  M extends ArvoContractVersionMapParam = ArvoContractVersionMapParam,
>(
  param: ArvoContractParam<T, M>,
): ArvoContract<T, M> => {
  const declared = tryCreateArvoContract(param);
  if (declared.ok) return declared.value;
  throw declared.error;
};
