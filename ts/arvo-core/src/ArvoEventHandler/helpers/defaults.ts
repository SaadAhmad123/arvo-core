import { ArvoDomain } from '../../ArvoDomain/index.js';
import type { ArvoEventHandlerOptions } from '../types/options.js';

/**
 * Every option's value where a declaration writes nothing.
 *
 * The only place in the package that spells a default. Each figure
 * implements one ADR-006 fixes, and a second copy is a copy that drifts.
 */
export const DEFAULT_OPTIONS: ArvoEventHandlerOptions = Object.freeze({
  maxDepth: 10_000,
  maxRetryAttempts: 3,
  retryDelay: 300,
  runTimeout: 30_000,
  executionTimeout: null,
  collect: 'all',
  handlerErrorDomain: ArvoDomain.LOCAL,
});

/** The option names, so nothing iterates a hand-written list of them. */
export const OPTION_KEYS = Object.keys(
  DEFAULT_OPTIONS,
) as (keyof ArvoEventHandlerOptions)[];
