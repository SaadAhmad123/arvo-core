import { ArvoContract } from '../../ArvoContract/index.js';
import { ErrorIssue } from '../../utils/error-issue.js';

/**
 * Judges whether what a handler was given to implement is a contract.
 *
 * A handler implements a whole contract and declares one executor per
 * version it holds, so a single version is not enough to declare one.
 *
 * Every other declaration rule reads the contract, so a refusal here is
 * marked blocking and nothing else is judged.
 *
 * @param contract - What the declaration named as the contract.
 * @returns The one blocking issue where it is not a contract, else nothing.
 *
 * @example
 * ```typescript
 * const issues = checkContract(declared.contracts.self);
 * if (issues.length > 0) throw new ArvoEventHandlerValidationError(issues);
 * ```
 */
export const checkContract = (contract: unknown): ErrorIssue[] => {
  if (contract instanceof ArvoContract) return [];

  return [
    new ErrorIssue({
      path: 'contracts.self',
      message:
        'must be an ArvoContract — a handler implements a whole contract, declaring one executor for each version it holds, so a single version of one is not enough',
      received: contract,
      blockingReason:
        'every other rule reads the contract: which versions need an executor, which types the handler may emit, and whether any two of them collide',
    }),
  ];
};
