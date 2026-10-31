import { err, ok } from 'neverthrow';
import * as z4 from 'zod/v4/core';
import { fromNeverthrow } from '../../result.js';
import type { Result } from '../../types.js';
import { ErrorIssue } from '../../utils/error-issue.js';
import { isObjectRecord } from './is-object-record.js';

/** One segment of a schema issue's path, as it is written after the root. */
const pathSegmentForKey = (key: PropertyKey): string =>
  typeof key === 'number' ? `[${key}]` : `.${String(key)}`;

/** The value at a schema issue's path, or nothing where the answer has none there. */
const valueAtPath = (
  answer: unknown,
  path: readonly PropertyKey[],
): unknown => {
  let node: unknown = answer;
  for (const key of path) {
    if (Array.isArray(node) && typeof key === 'number') node = node[key];
    else if (isObjectRecord(node) && typeof key === 'string') node = node[key];
    else return undefined;
  }
  return node;
};

/**
 * An outbox's answer as the schema produces it, unknown keys dropped, or
 * every issue the schema found, each named under `rootPath` with the value
 * found there.
 */
export const checkAgainstSchema = <Schema extends z4.$ZodType>(
  schema: Schema,
  answer: unknown,
  rootPath: string,
): Result<z4.output<Schema>, readonly ErrorIssue[]> => {
  const validation = z4.safeParse(schema, answer);
  if (validation.success) return fromNeverthrow(ok(validation.data));
  return fromNeverthrow(
    err(
      validation.error.issues.map(
        (schemaIssue) =>
          new ErrorIssue({
            path: `${rootPath}${schemaIssue.path.map(pathSegmentForKey).join('')}`,
            message: schemaIssue.message,
            received: valueAtPath(answer, schemaIssue.path),
          }),
      ),
    ),
  );
};
