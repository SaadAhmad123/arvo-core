import { createArvoContract } from 'arvo-core';
import { z } from 'zod';

/**
 * The orchestrator, at two versions.
 *
 * Both fan out, delegate a walk, ask for a review nothing here can do,
 * take payment and judge for fraud. They differ in what they remember
 * and what they answer with, so a mechanism routing an execution to the
 * wrong one of them cannot do so unnoticed — and so a rolling upgrade
 * is something this run can actually perform.
 */
export const orderFulfilContract = createArvoContract({
  type: 'com_order_fulfil',
  description: 'Fulfils one order, by asking everything else.',
  domain: 'orders',
  versions: {
    '1.0.0': {
      input: z.object({
        orderRef: z.string().min(1),
        category: z.string().min(1),
        /** How wide the fan-out is, so one run can be five hundred and another five. */
        width: z.number().int().positive(),
        /** How deep the walk goes. */
        depth: z.number().int().nonnegative(),
      }),
      outputs: {
        evt_order_fulfilled: z.object({
          orderRef: z.string(),
          checked: z.number().int().nonnegative(),
          approved: z.boolean(),
        }),
      },
    },

    // Remembers one thing more and answers with something the first
    // version never does, so neither can stand in for the other.
    '2.0.0': {
      input: z.object({
        orderRef: z.string().min(1),
        category: z.string().min(1),
        width: z.number().int().positive(),
        depth: z.number().int().nonnegative(),
        expedited: z.boolean(),
      }),
      outputs: {
        evt_order_dispatched: z.object({
          orderRef: z.string(),
          checked: z.number().int().nonnegative(),
          tracking: z.string(),
        }),
      },
    },
  },
});

export const orderFulfilV1 = orderFulfilContract.versions['1.0.0'];
export const orderFulfilV2 = orderFulfilContract.versions['2.0.0'];
