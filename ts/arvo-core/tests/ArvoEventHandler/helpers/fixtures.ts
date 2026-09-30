import { z } from 'zod';
import { ArvoContract } from '../../../src/ArvoContract/index.js';

/** Two versions, the first with an output and the second without. */
export const orderContract = new ArvoContract({
  type: 'com_order_create',
  versions: {
    '1.0.0': {
      input: z.object({ items: z.array(z.string()) }),
      outputs: { com_order_created: z.object({ order_id: z.string() }) },
    },
    '1.1.0': { input: z.object({ rush: z.boolean() }), outputs: {} },
  },
});

/** Two versions of one contract, for the duplicate-service rule. */
export const paymentContract = new ArvoContract({
  type: 'com_payment_charge',
  versions: {
    '1.0.0': { input: z.object({ amount: z.number() }), outputs: {} },
    '1.1.0': { input: z.object({ amount: z.number() }), outputs: {} },
  },
});

/** A different contract, so two services need not collide. */
export const shippingContract = new ArvoContract({
  type: 'com_shipping_book',
  versions: {
    '1.0.0': { input: z.object({ to: z.string() }), outputs: {} },
  },
});
