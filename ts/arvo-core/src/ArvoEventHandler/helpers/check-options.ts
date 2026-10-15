import { ArvoDomain } from '../../ArvoDomain/index.js';
import { ErrorIssue } from '../../utils/error-issue.js';
import type { ArvoEventHandlerOptions } from '../types/options.js';

/** The sources a domain may be named by rather than written out. */
const DOMAIN_SOURCES: readonly unknown[] = Object.values(ArvoDomain);

/** Whether a value is a whole count no smaller than the lowest allowed. */
const isWholeCountAtLeast = (value: unknown, lowest: number): boolean =>
  typeof value === 'number' && Number.isInteger(value) && value >= lowest;

/** What each option accepts, and how to say so when it is not met. */
const OPTION_RULES: {
  [TKey in keyof ArvoEventHandlerOptions]: {
    accepts: (value: unknown) => boolean;
    refusalMessage: string;
  };
} = {
  maxDepth: {
    accepts: (value) => isWholeCountAtLeast(value, 0),
    refusalMessage: 'must be a whole number of levels, zero or more',
  },
  maxRetryAttempts: {
    accepts: (value) => isWholeCountAtLeast(value, 0),
    refusalMessage: 'must be a whole number of attempts, zero or more',
  },
  retryDelay: {
    accepts: (value) =>
      typeof value === 'function' || isWholeCountAtLeast(value, 0),
    refusalMessage:
      'must be a whole number of milliseconds, zero or more, or a function working one out per attempt',
  },
  runTimeout: {
    accepts: (value) => value === null || isWholeCountAtLeast(value, 1),
    refusalMessage:
      'must be a whole number of milliseconds above zero, or null for no bound',
  },
  executionTimeout: {
    accepts: (value) => value === null || isWholeCountAtLeast(value, 1),
    refusalMessage:
      'must be a whole number of milliseconds above zero, or null for no bound',
  },
  collect: {
    accepts: (value) => value === 'all' || value === 'each',
    refusalMessage:
      "must be 'all' to enter once every answer is in, or 'each' to enter on every one",
  },
  handlerErrorDomain: {
    accepts: (value) =>
      value === null ||
      DOMAIN_SOURCES.includes(value) ||
      (typeof value === 'string' && value.trim() !== ''),
    refusalMessage:
      'must be a domain, one of ArvoDomain’s sources to read one from, or null for no domain',
  },
};

/**
 * Judges every option an author wrote against what its own type accepts.
 *
 * Judges what was written and not what is in force, so a value inherited
 * from the handler is never reported a second time against a version that
 * never wrote it. The relation spanning the two clocks is judged on the
 * resolved pair instead, by `checkTimeouts`.
 *
 * Reports rather than throwing, so a declaration with several faults is
 * refused once naming all of them.
 *
 * @param declared - What this level wrote, or `null` where it wrote nothing.
 * @param declaredAt - Where these options sit, which each issue is
 * reported under.
 * @returns One issue per option outside its type, in declaration order.
 *
 * @example
 * ```typescript
 * const issues = checkOptions({ maxDepth: -1 }, 'versions.1.0.0.options');
 * issues[0]?.path; // 'versions.1.0.0.options.maxDepth'
 * ```
 */
export const checkOptions = (
  declared: Partial<ArvoEventHandlerOptions> | null,
  declaredAt: string,
): ErrorIssue[] => {
  if (declared === null) return [];

  const issues: ErrorIssue[] = [];
  for (const key of Object.keys(
    OPTION_RULES,
  ) as (keyof ArvoEventHandlerOptions)[]) {
    // an option written undefined is an option not written, which is how
    // resolution reads it too
    const written = declared[key];
    if (written === undefined) continue;

    const rule = OPTION_RULES[key];
    if (rule.accepts(written)) continue;
    issues.push(
      new ErrorIssue({
        path: `${declaredAt}.${key}`,
        message: rule.refusalMessage,
        received: written,
      }),
    );
  }
  return issues;
};
