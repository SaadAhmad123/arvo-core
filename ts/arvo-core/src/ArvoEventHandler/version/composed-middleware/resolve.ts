import { err, Result as NeverthrowResult, ok } from 'neverthrow';
import { fromNeverthrow } from '../../../result.js';
import type { AsyncResult } from '../../../types.js';
import type {
  ArvoEventHandlerMiddlewareEntry,
  IArvoEventHandlerMiddleware,
} from '../../types/middleware.js';
import { ArvoComposedMiddlewareResolutionError } from './errors.js';
import { type ArvoMiddlewareSource, middlewarePosition } from './position.js';

/**
 * The layers of an execution, each way to make one replaced by what it
 * made, supplied and declared kept apart and each in the order given.
 *
 * Typed as the entries promise, and judged only by the composite's
 * constructor: a caller no compiler saw may have made something else.
 */
export type ArvoResolvedMiddleware = {
  /** The supplied layers. */
  supplied: readonly IArvoEventHandlerMiddleware[];
  /** The declared layers. */
  declared: readonly IArvoEventHandlerMiddleware[];
};

/** One list's entries made concurrently, or the first in it that threw. */
const resolveList = async (
  entries: readonly ArvoEventHandlerMiddlewareEntry[],
  source: ArvoMiddlewareSource,
) =>
  NeverthrowResult.combine(
    await Promise.all(
      entries.map(async (middlewareEntry, entryIndex) => {
        if (typeof middlewareEntry !== 'function') return ok(middlewareEntry);
        try {
          return ok(await middlewareEntry());
        } catch (error_) {
          return err(
            new ArvoComposedMiddlewareResolutionError({
              position: middlewarePosition(source, entryIndex),
              thrown: error_,
            }),
          );
        }
      }),
    ),
  );

/**
 * Calls each way to make a layer once, and puts what it made in its place.
 *
 * Supplied entries are resolved before declared ones; within a list the
 * ways to make a layer run concurrently, and the first in the list that
 * threw is the one reported. A list that throws stops resolution, so the
 * declared list is not resolved where a supplied entry threw.
 *
 * @param supplied - The entries this execution was given.
 * @param declared - The entries the handler declared.
 * @returns The resolved layers, or the error naming the way to make a
 * layer that threw.
 */
export const tryResolveMiddleware = async (
  supplied: readonly ArvoEventHandlerMiddlewareEntry[],
  declared: readonly ArvoEventHandlerMiddlewareEntry[],
): AsyncResult<
  ArvoResolvedMiddleware,
  ArvoComposedMiddlewareResolutionError
> => {
  const suppliedResolution = await resolveList(supplied, 'supplied');
  if (suppliedResolution.isErr()) {
    return fromNeverthrow(err(suppliedResolution.error));
  }
  const declaredResolution = await resolveList(declared, 'declared');
  if (declaredResolution.isErr()) {
    return fromNeverthrow(err(declaredResolution.error));
  }
  return fromNeverthrow(
    ok({
      supplied: suppliedResolution.value,
      declared: declaredResolution.value,
    }),
  );
};
