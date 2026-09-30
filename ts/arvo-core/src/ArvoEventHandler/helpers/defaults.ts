import { looseObject } from 'zod';
import type * as z from 'zod/v4/core';
import type { ArvoEventHandlerOptions } from '../types/options.js';

/**
 * The schema in force for a version that declared none.
 *
 * Loose rather than empty: `z.object({})` strips every key it was not told
 * about, so a closed default would silently empty an execution's data on
 * every write. This accepts any JSON object and keeps all of it.
 *
 * Its existence is why nothing downstream asks whether a version has a
 * schema before checking a value against one.
 */
export const ARVO_LOOSE_DATA_SCHEMA: z.$ZodObject = looseObject({});

/** Which shape of record this package writes. */
export const ARVO_RECORD_FORMAT_VERSION = '1.0.0';

/** Where an execution rests the moment it opens, before anything runs. */
export const ARVO_OPENING_LIFECYCLE = 'idle';

/** What a record's revision counts from when an execution opens. */
export const ARVO_OPENING_CAS_VERSION = 0;

/**
 * What every option is where an author wrote nothing, per ADR-006,
 * *Options*.
 *
 * The handler level is complete, so these are what a handler holds before
 * any version narrows them. The only place in this package that spells a
 * default.
 */
export const ARVO_DEFAULT_HANDLER_OPTIONS: ArvoEventHandlerOptions =
  Object.freeze({
    maxDepth: 10_000,
    maxRetryAttempts: 3,
    retryDelay: 300,
    runTimeout: 30_000,
    executionTimeout: null,
    collect: 'all',
    handlerErrorDomain: null,
  });

/**
 * The delay used where a `retryDelay` function fails at the moment it is
 * needed, per ADR-009, *`retry delay` must not be able to fail*.
 */
export const ARVO_RETRY_DELAY_FALLBACK_MS = 300;
