import { err, ok } from 'neverthrow';
import type * as z from 'zod/v4/core';
import type { VersionedArvoContract } from '../../../ArvoContract/versioned/index.js';
import { fromNeverthrow } from '../../../result.js';
import type { AsyncResult } from '../../../types.js';
import { ErrorIssue } from '../../../utils/error-issue.js';
import { textOfThrown } from '../../../utils/thrown-text.js';
import type { ArvoEventHandlerMiddlewareEntry } from '../../types/middleware.js';
import type { ArvoServiceMap } from '../../types/services.js';
import type {
  ArvoDependencies,
  ArvoMechanismHooks,
} from '../../types/supplied.js';
import {
  type ArvoComposedMiddlewareResolutionError,
  ArvoComposedMiddlewareValidationError,
} from './errors.js';
import { ArvoComposedMiddleware } from './index.js';
import { type ArvoMiddlewareSource, middlewarePosition } from './position.js';
import { tryResolveMiddleware } from './resolve.js';

/** What the layers of one execution are built from. */
export type ArvoComposedMiddlewareParam = {
  /** The entries this execution was given, or `null` for none. */
  supplied: readonly ArvoEventHandlerMiddlewareEntry[] | null;
  /** The entries the handler declared, or `null` for none. */
  declared: readonly ArvoEventHandlerMiddlewareEntry[] | null;
  /** Aborted by the version when the run clock fires. */
  abortSignal: AbortSignal;
};

/**
 * The layers of one execution, built in three steps, each stopping the
 * rest where it fails: both sides must be lists, every way to make a layer
 * is then called, and the composite's constructor then judges the layers.
 *
 * The type parameters are the context the composite will be handed: the
 * version's own contract, services, state schema, dependencies and hooks.
 *
 * @param param - The entries on each side, and the run clock's signal.
 * @returns The composite; a validation error where a side is not a list
 * or the layers break a rule; a resolution error where a way to make a
 * layer threw. Anything else the constructor throws goes up as thrown.
 */
export const tryCreateArvoComposedMiddleware = async <
  TSelf extends VersionedArvoContract = VersionedArvoContract,
  TServices extends ArvoServiceMap = ArvoServiceMap,
  TDataSchema extends z.$ZodObject = z.$ZodObject,
  TDependencies extends ArvoDependencies = ArvoDependencies,
  TMechanismHooks extends ArvoMechanismHooks = ArvoMechanismHooks,
>(
  param: ArvoComposedMiddlewareParam,
): AsyncResult<
  ArvoComposedMiddleware<
    TSelf,
    TServices,
    TDataSchema,
    TDependencies,
    TMechanismHooks
  >,
  ArvoComposedMiddlewareResolutionError | ArvoComposedMiddlewareValidationError
> => {
  // a caller no compiler saw may pass anything; omitted means none
  const sides = [
    { source: 'supplied' as const, entries: param.supplied ?? [] },
    { source: 'declared' as const, entries: param.declared ?? [] },
  ];
  const listIssues: ErrorIssue[] = [];
  const listsAsRead: Record<
    ArvoMiddlewareSource,
    ArvoEventHandlerMiddlewareEntry[]
  > = { supplied: [], declared: [] };
  for (const { source, entries } of sides) {
    if (!Array.isArray(entries)) {
      listIssues.push(
        new ErrorIssue({
          path: middlewarePosition(source),
          message:
            'must be an array, each entry a middleware (an object with a string `id`, and optional `before` and `after` functions) or a function returning one. To pass a single middleware, wrap it: middleware: [myMiddleware]',
          received: entries,
          blockingReason:
            'no middleware entry was checked, since the list itself is not an array',
        }),
      );
      continue;
    }
    try {
      // read once, every slot filled: a hole becomes undefined, which the constructor refuses
      listsAsRead[source] = Array.from(entries);
    } catch (thrown) {
      listIssues.push(
        new ErrorIssue({
          path: middlewarePosition(source),
          message: `could not be read: ${textOfThrown(thrown)}`,
          blockingReason:
            'no middleware entry was checked, since the list itself could not be read',
        }),
      );
    }
  }
  if (listIssues.length > 0) {
    return fromNeverthrow(
      err(
        new ArvoComposedMiddlewareValidationError(
          'middleware_instantiation_failed',
          'This execution was not run: its middleware must be given as an array that can be read. No middleware ran and the handler was not called.',
          listIssues,
        ),
      ),
    );
  }

  const resolution = await tryResolveMiddleware(
    listsAsRead.supplied,
    listsAsRead.declared,
  );
  if (!resolution.ok) return resolution;

  try {
    return fromNeverthrow(
      ok(
        new ArvoComposedMiddleware<
          TSelf,
          TServices,
          TDataSchema,
          TDependencies,
          TMechanismHooks
        >({
          supplied: resolution.value.supplied,
          declared: resolution.value.declared,
          abortSignal: param.abortSignal,
        }),
      ),
    );
  } catch (thrown) {
    if (thrown instanceof ArvoComposedMiddlewareValidationError) {
      return fromNeverthrow(err(thrown));
    }
    throw thrown;
  }
};
