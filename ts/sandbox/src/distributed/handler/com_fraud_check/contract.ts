import { createArvoContract } from 'arvo-core';
import { z } from 'zod';

/**
 * Work that never succeeds.
 *
 * It raises a fault no attempt can fix, which a mechanism must stop
 * retrying and must abandon with the pair the fault carries. Its caller
 * hears nothing until a mechanism gives up, and then hears exactly one
 * thing.
 */
export const fraudCheckContract = createArvoContract({
  type: 'com_fraud_check',
  description: 'Judges an order, and is permanently unable to.',
  versions: {
    '1.0.0': {
      input: z.object({ orderRef: z.string().min(1) }),
      outputs: {
        evt_fraud_judged: z.object({ risk: z.enum(['low', 'high']) }),
      },
    },
  },
});

export const fraudCheckV1 = fraudCheckContract.versions['1.0.0'];
