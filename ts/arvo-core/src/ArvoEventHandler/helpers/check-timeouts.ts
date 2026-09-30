import { ErrorIssue } from '../../utils/error-issue.js';
import type { ArvoEventHandlerOptions } from '../types/options.js';

/**
 * Reports the one relation that spans two options.
 *
 * Judged on the values in force for a version rather than on what it wrote:
 * a handler-level run timeout and a version-level execution timeout are each
 * reasonable alone and can be impossible together, so this can only be
 * answered after resolution.
 *
 * @param inForce - The options resolved for one version.
 * @param path - Where the problem is.
 */
export const checkTimeouts = (
  inForce: ArvoEventHandlerOptions,
  path: string,
): ErrorIssue[] => {
  const { runTimeout, executionTimeout } = inForce;
  if (executionTimeout === null) return [];

  const at = `${path}.executionTimeout`;
  if (runTimeout === null) {
    return [
      new ErrorIssue({
        path: at,
        message:
          'must be null where the run timeout in force is null, an unbounded attempt being longer than any bound on the whole execution',
        received: executionTimeout,
      }),
    ];
  }
  if (executionTimeout < runTimeout) {
    return [
      new ErrorIssue({
        path: at,
        message: `must not be below the run timeout in force (${runTimeout}ms), an attempt otherwise never completing inside the execution's own bound`,
        received: executionTimeout,
      }),
    ];
  }
  return [];
};
