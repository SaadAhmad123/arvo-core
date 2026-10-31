import { z } from 'zod';
import type { ArvoOutboxCapacity } from '../../ArvoOutbox/types/capacity.js';
import type { Result } from '../../types.js';
import type { ErrorIssue } from '../../utils/error-issue.js';
import { checkAgainstSchema } from './check-against-schema.js';

/** The shape of a capacity answer, built per check so no schema is shared. */
const buildCapacitySchema = () => {
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

/**
 * A capacity answer as the outbox gave it, unknown keys dropped, or every
 * problem found in it.
 */
export const checkCapacity = (
  answer: unknown,
): Result<ArvoOutboxCapacity, readonly ErrorIssue[]> =>
  checkAgainstSchema(buildCapacitySchema(), answer, 'capacity');
