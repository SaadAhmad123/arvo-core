import { setupArvoEventHandler } from 'arvo-core';
import { z } from 'zod';
import type { DistributedDependencies } from '../dependencies.js';
import { HANDLER_TELEMETRY } from '../telemetry.js';
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
  telemetry: HANDLER_TELEMETRY,
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
      /** How much this execution took, which is what it changed. */
      reserved: z.number(),
    }),
    execute: async (ctx) => {
      const requested = ctx.state.initEvent.data;
      const held = await ctx.dependencies.catalogue.heldOf(requested.sku);

      // Takes what it needs where there is enough, which is a handler
      // changing the world through a dependency rather than reading one.
      const reserved =
        held >= requested.wanted
          ? await ctx.dependencies.catalogue.reserve(
              requested.sku,
              requested.wanted,
            )
          : 0;

      await ctx.setState({ data: { sku: requested.sku, held, reserved } });

      ctx.telemetry.logger.info(`checked ${requested.sku}`, {
        sku: requested.sku,
        held,
        wanted: requested.wanted,
      });

      return ctx.build({
        type: 'evt_inventory_checked',
        data: {
          sku: requested.sku,
          held,
          sufficient: held >= requested.wanted,
        },
      });
    },
  })
  .build();
