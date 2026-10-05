import { createArvoContract } from 'arvo-core';
import { z } from 'zod';

/**
 * Work that fails and then does not.
 *
 * It refuses the first few attempts and succeeds after, keyed on the
 * attempt number rather than on anything it remembers — so every
 * mechanism agrees on what it does, and the attempt number crossing the
 * boundary intact is what the agreement rests on.
 */
export const paymentChargeContract = createArvoContract({
  type: 'com_payment_charge',
  description: 'Takes payment, unreliably at first.',
  versions: {
    '1.0.0': {
      input: z.object({
        amount: z.number().positive(),
        currency: z.string().length(3),
        /** How many attempts this charge refuses before it succeeds. */
        failuresBeforeSuccess: z.number().int().nonnegative(),
      }),
      outputs: {
        evt_payment_charged: z.object({
          receipt: z.string(),
          attempts: z.number().int().nonnegative(),
        }),
      },
    },
  },
});

export const paymentChargeV1 = paymentChargeContract.versions['1.0.0'];
