import { ArvoContract } from '../../ArvoContract/index.js';
import { ErrorIssue } from '../../utils/error-issue.js';

/**
 * Reports a contract that is not one, and says why nothing else was checked.
 *
 * The one blocking rule of a declaration. Every other rule reads the
 * contract — which versions exist, what each declares, what its handler
 * error type is — so judging them against something that is not a contract
 * would quote values the declaration never had.
 *
 * @param contract - What was declared, which a JavaScript caller may make
 * anything at all.
 */
export const checkContract = (contract: unknown): ErrorIssue[] =>
  contract instanceof ArvoContract
    ? []
    : [
        new ErrorIssue({
          path: 'contract',
          message: 'must be an ArvoContract',
          received: contract,
          blockingReason:
            'every other rule reads the contract, so none could be checked',
        }),
      ];
