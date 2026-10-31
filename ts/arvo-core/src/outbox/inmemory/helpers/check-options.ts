import { z } from 'zod';
import { checkAgainstSchema } from '../../../utils/check-against-schema.js';
import { ArvoMemoryOutboxValidationError } from '../errors.js';
import type { ArvoMemoryOutboxOptions } from '../types.js';

/** The shape of the options, built per check so no schema is shared. */
const buildOptionsSchema = () => {
  const bufferSchema = z.strictObject({
    size: z.number().int().positive(),
    tolerance: z.number().min(0).max(1),
  });
  const retentionSchema = z.number().int().nonnegative().optional();
  return z.strictObject({
    clock: z
      .custom<() => Date>((candidate) => typeof candidate === 'function', {
        message: 'must be a function returning a Date',
      })
      .optional(),
    buffers: z
      .strictObject({
        events: bufferSchema.optional(),
        states: bufferSchema.optional(),
      })
      .optional(),
    retentionMs: z
      .strictObject({
        seenEvents: retentionSchema,
        terminalStates: retentionSchema,
      })
      .optional(),
  });
};

/**
 * The options as given, every rule they break reported at once as
 * {@link ArvoMemoryOutboxValidationError}.
 */
export const checkOptions = (options: unknown): ArvoMemoryOutboxOptions => {
  const optionsResult = checkAgainstSchema(
    buildOptionsSchema(),
    options,
    'options',
  );
  if (!optionsResult.ok) {
    throw new ArvoMemoryOutboxValidationError(optionsResult.error);
  }
  return optionsResult.value;
};
