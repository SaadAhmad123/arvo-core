import { ErrorIssue } from '../../utils/error-issue.js';
import type { ArvoEventHandlerMiddlewareEntry } from '../types/middleware.js';

/**
 * What is wrong with something offered as a layer, or nothing.
 *
 * A layer is an object with a string identifier, and whichever of its two
 * parts it has are things to call. Read here rather than trusted from the
 * type, because a list of layers may arrive from code no compiler saw.
 *
 * @param offered - The value offered as a layer.
 * @param path - Where it sits, for the issue to name.
 * @returns One issue per thing wrong with it; empty where it is a layer.
 */
export const describeUnlikeLayer = (
  offered: unknown,
  path: string,
): ErrorIssue[] => {
  if (typeof offered !== 'object' || offered === null) {
    return [
      new ErrorIssue({
        path,
        message:
          'is not a layer: a layer is an object with a string `id`, and optionally `before` and `after`',
        received: offered,
      }),
    ];
  }

  const { id, before, after } = offered as Record<string, unknown>;
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
  for (const [part, value] of [
    ['before', before],
    ['after', after],
  ] as const) {
    if (value !== undefined && typeof value !== 'function') {
      issues.push(
        new ErrorIssue({
          path: `${path}.${part}`,
          message: `must be something to call, or left out`,
          received: value,
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
  const firstAt = new Map<string, number>();

  middleware.forEach((entry, index) => {
    if (typeof entry === 'function') return;

    const path = `middleware[${index}]`;
    const unlike = describeUnlikeLayer(entry, path);
    if (unlike.length > 0) {
      issues.push(...unlike);
      return;
    }

    const already = firstAt.get(entry.id);
    if (already === undefined) {
      firstAt.set(entry.id, index);
      return;
    }
    issues.push(
      new ErrorIssue({
        path: `${path}.id`,
        message: `repeats the identifier "${entry.id}", already declared at middleware[${already}]. Two layers in one execution cannot share an identifier`,
      }),
    );
  });

  return issues;
};
