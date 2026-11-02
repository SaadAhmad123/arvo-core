import { z } from 'zod';
import { checkAgainstSchema } from '../../../utils/check-against-schema.js';
import { ArvoSqliteOutboxValidationError } from '../errors.js';
import type { ArvoSqliteOutboxOptions } from '../types.js';

/** The shape of the options, built per check so no schema is shared. */
const buildOptionsSchema = () => {
  const durationMsSchema = z.number().int().nonnegative();
  const retentionMsSchema = z
    .union([durationMsSchema, z.literal(Number.POSITIVE_INFINITY)])
    .optional();
  return z.strictObject({
    filename: z.string(),
    busyTimeoutMs: durationMsSchema.optional(),
    retentionMs: z
      .strictObject({
        seenEvents: retentionMsSchema,
        terminalStates: retentionMsSchema,
      })
      .optional(),
  });
};

/**
 * The options as given, every rule they break reported at once as
 * {@link ArvoSqliteOutboxValidationError}.
 */
export const checkOptions = (options: unknown): ArvoSqliteOutboxOptions => {
  const optionsResult = checkAgainstSchema(
    buildOptionsSchema(),
    options,
    'options',
  );
  if (!optionsResult.ok) {
    throw new ArvoSqliteOutboxValidationError(optionsResult.error);
  }
  return optionsResult.value;
};
