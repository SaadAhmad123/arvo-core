import type { Result as NeverthrowResult, ResultAsync } from 'neverthrow';
import type { AsyncResult, Result } from './types.js';

/**
 * Converts a `neverthrow` `Result` into the package's own plain `Result`.
 *
 * The boundary every `tryX` crosses on the way out: `neverthrow` builds the
 * value internally, this converts it before it becomes public API, so
 * `neverthrow` itself never appears in an exported type.
 */
export const fromNeverthrow = <R, E>(
  neverthrowResult: NeverthrowResult<R, E>,
): Result<R, E> =>
  neverthrowResult.isOk()
    ? { ok: true, value: neverthrowResult.value }
    : { ok: false, error: neverthrowResult.error };

/**
 * {@link fromNeverthrow}, for a `neverthrow` `ResultAsync`.
 *
 * Not yet used by anything in this package — no `tryX` here is
 * asynchronous. Built alongside the synchronous boundary rather than
 * added later, so the pattern is already in place when one is.
 */
export const fromNeverthrowAsync = <R, E>(
  neverthrowResult: ResultAsync<R, E>,
): AsyncResult<R, E> => Promise.resolve(neverthrowResult).then(fromNeverthrow);
