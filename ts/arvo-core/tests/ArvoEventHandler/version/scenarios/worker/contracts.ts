import { z } from 'zod';
import { ArvoContract } from '../../../../../dist/ArvoContract/index.js';
import { ARVO_DEFAULT_HANDLER_OPTIONS } from '../../../../../dist/ArvoEventHandler/helpers/defaults.js';
import { ArvoEventHandlerVersion } from '../../../../../dist/ArvoEventHandler/version/index.js';

/**
 * What both sides of a real thread boundary agree on.
 *
 * Imported by the workers and by whatever is brokering for them, from
 * the built package rather than the source, because a worker thread
 * loads what a deployment would load.
 */

export const workState = z.object({ stage: z.string(), answers: z.number() });

export const orderContract = new ArvoContract({
  type: 'com_threaded_order',
  versions: {
    '1.0.0': {
      input: z.object({ items: z.array(z.string()) }),
      outputs: { evt_threaded_order_done: z.object({ order_id: z.string() }) },
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
export const chargeV1 = chargeContract.versions['1.0.0'];

/**
 * How a charge behaves, whichever thread it lands in.
 *
 * - `succeeds` — answers first time.
 * - `errors` — concludes it cannot do the work, which is an answer.
 * - `faults` — raises a retryable fault every time, so attempts run out
 *   and the execution is abandoned.
 * - `flaky` — raises a retryable fault until the third attempt, then
 *   answers. Keyed off the attempt rather than anything the thread holds,
 *   so every thread agrees on what this charge does.
 */
export type ChargeBehaviour = 'succeeds' | 'errors' | 'faults' | 'flaky';

/** How the two behave, identically in every thread that runs them. */
export const declareThreadedVersions = (
  charges: ChargeBehaviour = 'succeeds',
) => ({
  [orderContract.type]: {
    '1.0.0': new ArvoEventHandlerVersion({
      contracts: { self: orderV1, services: { charge: chargeV1 } },
      options: ARVO_DEFAULT_HANDLER_OPTIONS,
      state: workState,
      // the built package is loaded at runtime, so the context's own type
      // is not available to annotate this with
      execute: async (ctx: any) => {
        if (ctx.entry === 'followup') {
          await ctx.setState({ data: { stage: 'answering', answers: 1 } });
          return ctx.build({
            type: 'evt_threaded_order_done',
            data: { order_id: ctx.state.subject },
          });
        }
        await ctx.setState({ data: { stage: 'asking', answers: 0 } });
        return ctx.build({
          type: 'com_threaded_charge',
          data: { amount: 10 },
        });
      },
    }),
  },
  [chargeContract.type]: {
    '1.0.0': new ArvoEventHandlerVersion({
      contracts: { self: chargeV1, services: {} },
      options: ARVO_DEFAULT_HANDLER_OPTIONS,
      state: workState,
      // as above
      execute: async (ctx: any) => {
        if (charges === 'errors') throw new Error('the gateway is down');
        if (charges === 'faults' || (charges === 'flaky' && ctx.attempt < 2)) {
          throw await ctx.fault({
            faultKind: 'executor_raised',
            message: 'the gateway did not answer in time',
            retryable: true,
          });
        }
        await ctx.setState({ data: { stage: 'charged', answers: 0 } });
        return ctx.build({
          type: 'evt_threaded_charged',
          data: { receipt: `r-${ctx.state.subject}` },
        });
      },
    }),
  },
});
