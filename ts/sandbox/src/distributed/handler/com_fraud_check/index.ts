import { setupArvoEventHandler } from 'arvo-core';
import { z } from 'zod';
import type { DistributedDependencies } from '../dependencies.js';
import { fraudCheckContract } from './contract.js';

/**
 * Work that never succeeds.
 *
 * It raises a fault and says no attempt will fix it, which obliges a
 * mechanism to stop rather than to keep trying — and, if it gives up,
 * to commit the record and publish the event the fault carries, as
 * handed, together.
 *
 * Nothing here composes either of those. That is the point: a mechanism
 * that cannot be told to stop, or that invents its own answer for a
 * caller, fails against this handler and against nothing else in the
 * run.
 */
export const fraudCheckHandler = setupArvoEventHandler({
  contracts: { self: fraudCheckContract },
  types: {} as { dependencies: DistributedDependencies },
  options: { runTimeout: 5_000 },
})
  .handler('1.0.0', {
    state: z.object({ asked: z.string() }),
    execute: async (ctx) => {
      const asked = ctx.state.initEvent.data;
      await ctx.setState({ data: { asked: asked.orderRef } });

      ctx.telemetry.logger.error('the model this needs is not deployed', {
        orderRef: asked.orderRef,
      });

      throw await ctx.fault({
        faultKind: 'executor_raised',
        message: `no fraud model is deployed for ${asked.orderRef}, so this cannot be judged now or later`,
        retryable: false,
      });
    },
  })
  .build();
