import { ArvoDomain } from '../../ArvoDomain/index.js';
import { ErrorIssue } from '../../utils/error-issue.js';
import type { ArvoEventHandlerOptions } from '../types/options.js';
import { OPTION_KEYS } from './defaults.js';

const DOMAIN_SYMBOLS: readonly symbol[] = Object.values(ArvoDomain);

const isCount = (value: unknown): boolean =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

const isDuration = (value: unknown): boolean =>
  typeof value === 'number' && Number.isInteger(value) && value > 0;

/** What each option accepts, and how to say so when it does not. */
const ACCEPTS: {
  [K in keyof ArvoEventHandlerOptions]: {
    ok: (value: unknown) => boolean;
    must: string;
  };
} = {
  maxDepth: { ok: isCount, must: 'must be a non-negative integer' },
  maxRetryAttempts: { ok: isCount, must: 'must be a non-negative integer' },
  retryDelay: {
    ok: (v) => isCount(v) || typeof v === 'function',
    must: 'must be a non-negative integer number of milliseconds, or a function returning one',
  },
  runTimeout: {
    ok: (v) => v === null || isDuration(v),
    must: 'must be a positive integer number of milliseconds, or null for unbounded',
  },
  executionTimeout: {
    ok: (v) => v === null || isDuration(v),
    must: 'must be a positive integer number of milliseconds, or null for unbounded',
  },
  collect: {
    ok: (v) => v === 'all' || v === 'each',
    must: "must be 'all' or 'each'",
  },
  handlerErrorDomain: {
    ok: (v) =>
      (typeof v === 'string' && v.length > 0) ||
      (typeof v === 'symbol' && DOMAIN_SYMBOLS.includes(v)),
    must: "must be a non-empty domain string, or one of ArvoDomain's symbols",
  },
};

/**
 * Reports every option outside what it accepts, and reports rather than
 * throwing so a declaration can collect across all of its rules.
 *
 * Checks what was written, not what was resolved: an inherited value was
 * already checked where it was declared, and reporting it twice would name
 * a version for a mistake made at the handler.
 *
 * @param declared - What was written at this level, if anything.
 * @param path - Where the problem is, such as `versions["1.0.0"].options`.
 */
export const checkOptions = (
  declared: Partial<ArvoEventHandlerOptions> | null,
  path: string,
): ErrorIssue[] => {
  if (declared === null) return [];
  return OPTION_KEYS.flatMap((key) => {
    const value = declared[key];
    if (value === undefined || ACCEPTS[key].ok(value)) return [];
    return [
      new ErrorIssue({
        path: `${path}.${key}`,
        message: ACCEPTS[key].must,
        received: value,
      }),
    ];
  });
};
