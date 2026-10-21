import { err, ok } from 'neverthrow';
import * as z from 'zod/v4/core';
import { ArvoEventValidationError } from '../../ArvoEvent/errors.js';
import { fromNeverthrow } from '../../result.js';
import type { Result } from '../../types.js';
import { ErrorIssue } from '../../utils/error-issue.js';

/**
 * Checks a payload against one of a version's schemas, and returns what the
 * check produced.
 *
 * The produced value is the event's payload, not the value passed in, so a
 * schema's declared default reaches the event. Issues are the schema's own:
 * its path beneath `data`, its message as it stands, and the value found at
 * that position.
 */
export const checkPayload = <S extends z.$ZodObject>(
  schema: S,
  data: unknown,
  schemaLabel: string,
): Result<z.output<S>, ArvoEventValidationError> => {
  const validation = z.safeParse(schema, data);

  if (!validation.success) {
    return fromNeverthrow(
      err(
        new ArvoEventValidationError(
          validation.error.issues.map(
            (issue) =>
              new ErrorIssue({
                path: ['data', ...issue.path].join('.'),
                message: `${issue.message} (against the contract's ${schemaLabel})`,
                received: valueAtPath(data, issue.path),
              }),
          ),
        ),
      ),
    );
  }

  return fromNeverthrow(ok(validation.data));
};

/** The value at a schema issue's path, the schema not reporting one itself. */
const valueAtPath = (
  payload: unknown,
  path: readonly PropertyKey[],
): unknown => {
  let node: unknown = payload;
  for (const segment of path) {
    if (node === null || typeof node !== 'object') return undefined;
    node = (node as Record<PropertyKey, unknown>)[segment];
  }
  return node;
};
