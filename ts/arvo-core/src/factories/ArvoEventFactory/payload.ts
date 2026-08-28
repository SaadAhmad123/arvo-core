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
  what: string,
): Result<z.output<S>, ArvoEventValidationError> => {
  const result = z.safeParse(schema, data);

  if (!result.success) {
    return fromNeverthrow(
      err(
        new ArvoEventValidationError(
          result.error.issues.map(
            (issue) =>
              new ErrorIssue({
                path: ['data', ...issue.path].join('.'),
                message: `${issue.message} (against the contract's ${what})`,
                received: valueAt(data, issue.path),
              }),
          ),
        ),
      ),
    );
  }

  return fromNeverthrow(ok(result.data));
};

/** The value at a schema issue's path, the schema not reporting one itself. */
const valueAt = (payload: unknown, path: readonly PropertyKey[]): unknown => {
  let current: unknown = payload;
  for (const key of path) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<PropertyKey, unknown>)[key];
  }
  return current;
};
