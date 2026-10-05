import { setupArvoEventHandler } from 'arvo-core';
import { z } from 'zod';
import type { DistributedDependencies } from '../dependencies.js';
import { inventoryCheckContract } from './contract.js';

/**
 * One item, checked and answered.
 *
 * It remembers what it found, which is the smallest state worth having:
 * a record whose data is empty would make a fan-out of five hundred
 * cost nothing to carry, and the cost is part of what is being measured.
 */
export const inventoryCheckHandler = setupArvoEventHandler({
  contracts: { self: inventoryCheckContract },
  types: {} as { dependencies: DistributedDependencies },
  options: {
    // one query against a catalogue; longer than this and something is wrong
    runTimeout: 5_000,
    maxRetryAttempts: 3,
  },
})
  .handler('1.0.0', {
    state: z.object({
      sku: z.string(),
      held: z.number(),
    }),
    execute: async (ctx) => {
      const asked = ctx.state.initEvent.data;
      const held = await ctx.dependencies.catalogue.heldOf(asked.sku);

      await ctx.setState({ data: { sku: asked.sku, held } });

      ctx.telemetry.logger.info(`checked ${asked.sku}`, {
        sku: asked.sku,
        held,
        wanted: asked.wanted,
      });

      return ctx.build({
        type: 'evt_inventory_checked',
        data: { sku: asked.sku, held, sufficient: held >= asked.wanted },
      });
    },
  })
  .build();
