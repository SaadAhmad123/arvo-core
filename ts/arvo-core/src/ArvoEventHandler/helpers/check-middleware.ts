import { ErrorIssue } from '../../utils/error-issue.js';
import type { ArvoEventHandlerMiddlewareEntry } from '../types/middleware.js';

/**
 * What is wrong with something offered as a layer, or nothing.
 *
 * A layer is an object with a string identifier, and whichever of its two
 * parts it has are things to call. Read here rather than trusted from the
 * type, because a list of layers may arrive from code no compiler saw.
 *
 * @param candidate - The value offered as a layer.
 * @param path - Where it sits, for the issue to name.
 * @returns One issue per thing wrong with it; empty where it is a layer.
 */
export const layerShapeIssues = (
  candidate: unknown,
  path: string,
): ErrorIssue[] => {
  if (typeof candidate !== 'object' || candidate === null) {
    return [
      new ErrorIssue({
        path,
        message:
          'is not a layer: a layer is an object with a string `id`, and optionally `before` and `after`',
        received: candidate,
      }),
    ];
  }

  const { id, before, after } = candidate as Record<string, unknown>;
  const issues: ErrorIssue[] = [];
  if (typeof id !== 'string') {
    issues.push(
      new ErrorIssue({
        path,
        message: 'is not a layer: its `id` must be a string',
        received: id,
      }),
    );
  }
  for (const [hookName, hook] of [
    ['before', before],
    ['after', after],
  ] as const) {
    if (hook !== undefined && typeof hook !== 'function') {
      issues.push(
        new ErrorIssue({
          path: `${path}.${hookName}`,
          message: `must be something to call, or left out`,
          received: hook,
        }),
      );
    }
  }
  return issues;
};

/**
 * Judges the layers a handler declares.
 *
 * Each one that is not a way to make a layer must be a layer, and no two
 * may share an identifier. A way to make one is not called here: it is
 * called once per execution, and is judged then.
 *
 * @param middleware - The layers as declared.
 * @returns One issue per thing wrong, each naming where it is.
 *
 * @example
 * ```typescript
 * checkMiddleware([{ id: 'audit', after: record }, () => ({ id: 'timer' })]);
 * ```
 */
export const checkMiddleware = (
  middleware: readonly ArvoEventHandlerMiddlewareEntry[],
): ErrorIssue[] => {
  if (!Array.isArray(middleware)) {
    return [
      new ErrorIssue({
        path: 'middleware',
        message: 'must be a list of layers, or ways to make one',
        received: middleware,
      }),
    ];
  }
  const issues: ErrorIssue[] = [];
  const firstIndexById = new Map<string, number>();

  middleware.forEach((middlewareEntry, entryIndex) => {
    if (typeof middlewareEntry === 'function') return;

    const path = `middleware[${entryIndex}]`;
    const shapeIssues = layerShapeIssues(middlewareEntry, path);
    if (shapeIssues.length > 0) {
      issues.push(...shapeIssues);
      return;
    }

    const earlierIndex = firstIndexById.get(middlewareEntry.id);
    if (earlierIndex === undefined) {
      firstIndexById.set(middlewareEntry.id, entryIndex);
      return;
    }
    issues.push(
      new ErrorIssue({
        path: `${path}.id`,
        message: `repeats the identifier "${middlewareEntry.id}", already declared at middleware[${earlierIndex}]. Two layers in one execution cannot share an identifier`,
      }),
    );
  });

  return issues;
};
