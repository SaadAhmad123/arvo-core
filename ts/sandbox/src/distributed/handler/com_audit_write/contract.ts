import { createArvoContract } from 'arvo-core';
import { z } from 'zod';

/**
 * Work that answers nobody.
 *
 * No outputs and no services: the one shape whose executor legitimately
 * returns nothing, resting at `success` because there was nothing it
 * could have returned. A framework expecting every unit of work to
 * produce a value meets it here.
 *
 * Anything asking for one must do so in the same batch as its own
 * completion, or it waits forever for an answer that does not exist.
 */
export const auditWriteContract = createArvoContract({
  type: 'com_audit_write',
  description: 'Records what happened, and tells nobody it did.',
  versions: {
    '1.0.0': {
      input: z.object({
        orderRef: z.string().min(1),
        outcome: z.string().min(1),
      }),
      outputs: {},
    },
  },
});

export const auditWriteV1 = auditWriteContract.versions['1.0.0'];
