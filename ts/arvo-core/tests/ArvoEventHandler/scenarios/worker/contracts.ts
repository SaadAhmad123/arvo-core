import { z } from 'zod';
import { ArvoContract } from '../../../../dist/ArvoContract/index.js';
import { setupArvoEventHandler } from '../../../../dist/factories/setupArvoEventHandler.js';

/**
 * What both sides of a real thread boundary agree on.
 *
 * Loaded from the built package rather than the source, because a worker
 * thread loads what a deployment would load — and imported by the worker
 * and by whatever is brokering for it, so the two cannot drift.
 */

export const orderContract = new ArvoContract({
  type: 'com_threaded_order',
  versions: {
    '1.0.0': {
      input: z.object({ items: z.array(z.string()) }),
      outputs: { evt_threaded_order_done: z.object({ order_id: z.string() }) },
    },
    // a second version, so routing is something a thread can get wrong
    '2.0.0': {
      input: z.object({ items: z.array(z.string()) }),
      outputs: { evt_threaded_order_shipped: z.object({ at: z.string() }) },
    },
  },
});

export const chargeContract = new ArvoContract({
  type: 'com_threaded_charge',
  versions: {
    '1.0.0': {
      input: z.object({ amount: z.number() }),
      outputs: { evt_threaded_charged: z.object({ receipt: z.string() }) },
    },
  },
});

export const orderV1 = orderContract.versions['1.0.0'];
export const orderV2 = orderContract.versions['2.0.0'];
export const chargeV1 = chargeContract.versions['1.0.0'];

/** How a charge behaves wherever it runs. */
export type ChargeBehaviour = 'succeeds' | 'errors';

/**
 * Every handler a thread can run, keyed by what an event addresses.
 *
 * Declared identically in every thread, so which thread ran an event
 * cannot change what it did.
 */
export const declareThreadedHandlers = (
  charges: ChargeBehaviour = 'succeeds',
) => ({
  [orderContract.type]: setupArvoEventHandler({
    contracts: { self: orderContract, services: { charge: chargeV1 } },
  })
    .handler('1.0.0', {
      state: z.object({ stage: z.string() }),
      execute: async (ctx) => {
        if (ctx.entry === 'followup') {
          await ctx.setState({ data: { stage: 'answering' } });
          return ctx.build({
            type: 'evt_threaded_order_done',
            data: { order_id: ctx.state.subject },
          });
        }
        await ctx.setState({ data: { stage: 'asking' } });
        return ctx.build({ type: 'com_threaded_charge', data: { amount: 10 } });
      },
    })
    // remembers nothing, and answers at once
    .handler('2.0.0', async (ctx) =>
      ctx.build({
        type: 'evt_threaded_order_shipped',
        data: { at: ctx.state.subject },
      }),
    )
    .build(),

  [chargeContract.type]: setupArvoEventHandler({
    contracts: { self: chargeContract },
  })
    .handler('1.0.0', {
      state: z.object({ stage: z.string() }),
      execute: async (ctx) => {
        if (charges === 'errors') throw new Error('the gateway is down');
        await ctx.setState({ data: { stage: 'charged' } });
        return ctx.build({
          type: 'evt_threaded_charged',
          data: { receipt: `r-${ctx.state.subject}` },
        });
      },
    })
    .build(),
});
