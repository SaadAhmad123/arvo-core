import { z } from 'zod';
import type { ArvoOutboxCapacity } from '../../ArvoOutbox/types/capacity.js';
import type { Result } from '../../types.js';
import { checkAgainstSchema } from '../../utils/check-against-schema.js';
import type { ErrorIssue } from '../../utils/error-issue.js';

/** The shape of a capacity answer, built once by each driver and held by it. */
export const buildCapacitySchema = () => {
  const statusSchema = z.enum(['available', 'tolerating', 'exhausted']);
  const countSchema = z.number().int().nonnegative().optional();
  const bufferSchema = z.object({
    status: statusSchema,
    held: countSchema,
    size: countSchema,
    limit: countSchema,
  });
  return z.object({
    status: statusSchema,
    buffers: z.object({
      events: bufferSchema.optional(),
      states: bufferSchema.optional(),
    }),
  });
};

/** A capacity answer's schema, as {@link buildCapacitySchema} builds it. */
export type CapacitySchema = ReturnType<typeof buildCapacitySchema>;

/**
 * A capacity answer as the outbox gave it, unknown keys dropped, or every
 * problem found in it.
 */
export const checkCapacity = (
  schema: CapacitySchema,
  answer: unknown,
): Result<ArvoOutboxCapacity, readonly ErrorIssue[]> =>
  checkAgainstSchema(schema, answer, 'capacity');
