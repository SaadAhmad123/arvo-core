import { ErrorIssue } from '../../utils/error-issue.js';
import type { ArvoEventHandlerOptions } from '../types/options.js';

/**
 * Judges the one rule that spans both clocks, on the pair in force.
 *
 * An execution may not be allowed less time than one attempt of it: an
 * attempt that may run longer than the whole execution could never finish
 * inside it, and an unbounded attempt is longer than any bound at all.
 * Either way the version could never succeed, which is a defect visible
 * before any event exists.
 *
 * Judged on the resolved pair rather than on what was written, because the
 * two halves may be declared at different levels and it is their settled
 * values that an execution runs under.
 *
 * @param inForce - Every option as it settled for this version.
 * @param at - Which version these are in force for.
 * @returns The one issue where the pair cannot work, else nothing.
 *
 * @example
 * ```typescript
 * const issues = checkTimeouts(inForce, 'versions.1.0.0');
 * issues[0]?.path; // 'versions.1.0.0.options.executionTimeout'
 * ```
 */
export const checkTimeouts = (
  inForce: ArvoEventHandlerOptions,
  at: string,
): ErrorIssue[] => {
  const { runTimeout, executionTimeout } = inForce;
  if (executionTimeout === null) return [];

  const path = `${at}.options.executionTimeout`;
  if (runTimeout === null) {
    return [
      new ErrorIssue({
        path,
        message:
          'must be null where runTimeout is null: one attempt may run without bound, so no bound on the whole execution could ever hold',
        received: executionTimeout,
      }),
    ];
  }

  if (executionTimeout < runTimeout) {
    return [
      new ErrorIssue({
        path,
        message: `must not be below runTimeout, which is ${runTimeout}ms: an attempt allowed longer than the execution it belongs to could never finish inside it`,
        received: executionTimeout,
      }),
    ];
  }
  return [];
};
