import type { ArvoEventHandlerOptions } from '../types/options.js';

/** Which shape of record this package writes. */
export const ARVO_RECORD_FORMAT_VERSION = '1.0.0';

/** Where an execution rests the moment it opens, before anything runs. */
export const ARVO_OPENING_LIFECYCLE = 'idle';

/** What a record's revision counts from when an execution opens. */
export const ARVO_OPENING_CAS_VERSION = 0;

/**
 * What every option is where an author wrote nothing.
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
 * needed, that function not being allowed to fail.
 */
export const ARVO_RETRY_DELAY_FALLBACK_MS = 300;

/** What an event opening an execution declares itself to be. */
export const ARVO_CATEGORY_INIT = 'io.arvo.init';

/** What an event completing an execution declares itself to be. */
export const ARVO_CATEGORY_COMPLETE = 'io.arvo.complete';
