import { createArvoContract } from 'arvo-core';
import { z } from 'zod';

/**
 * What a fan-out fans out over.
 *
 * One execution of this per item, and a run holds five hundred of them
 * at once. It answers immediately, so what it tests is not its own
 * behaviour but whether a mechanism can carry that many executions of
 * one contract against one record.
 */
export const inventoryCheckContract = createArvoContract({
  type: 'com_inventory_check',
  description: 'Whether one item can be supplied, asked once per item.',
  versions: {
    '1.0.0': {
      input: z.object({
        sku: z.string().min(1),
        wanted: z.number().int().positive(),
      }),
      outputs: {
        evt_inventory_checked: z.object({
          sku: z.string(),
          held: z.number().int().nonnegative(),
          sufficient: z.boolean(),
        }),
      },
    },
  },
});

export const inventoryCheckV1 = inventoryCheckContract.versions['1.0.0'];
