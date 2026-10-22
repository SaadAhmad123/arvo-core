import { z } from 'zod';
import { ArvoContract } from '../../src/ArvoContract/index.js';
import { setupArvoEventHandler } from '../../src/factories/setupArvoEventHandler.js';
import {
  orderContract,
  paymentContract,
  paymentVersion,
} from '../ArvoEventHandler/fixtures.js';

/** A contract nothing else in these fixtures uses, for a third handler. */
export const auditContract = new ArvoContract({
  type: 'com_audit_record',
  versions: {
    '1.0.0': {
      input: z.object({ entry: z.string() }),
      outputs: { evt_audit_recorded: z.object({ entry: z.string() }) },
    },
  },
});

/** Calls the payment contract as a service; declares its own dependency and hook. */
export const orderHandler = () =>
  setupArvoEventHandler({
    contracts: { self: orderContract, services: { payments: paymentVersion } },
    types: {} as {
      dependencies: { orders: string };
      mechanismHooks: { ticket: string };
    },
  })
    .handler('1.0.0', {
      state: z.object({ stage: z.string() }),
      execute: async (ctx) => {
        await ctx.setState({ data: { stage: 'seen' } });
      },
    })
    .build();

/** Implements the payment contract; declares a dependency of another shape. */
export const paymentHandler = () =>
  setupArvoEventHandler({
    contracts: { self: paymentContract },
    types: {} as { dependencies: { ledger: number } },
  })
    .handler('1.0.0', {
      state: z.object({ charged: z.boolean() }),
      execute: async (ctx) => {
        await ctx.setState({ data: { charged: true } });
      },
    })
    .build();

/** Declares no dependencies and no hooks. */
export const auditHandler = () =>
  setupArvoEventHandler({ contracts: { self: auditContract } })
    .handler('1.0.0', {
      state: z.object({ recorded: z.boolean() }),
      execute: async (ctx) => {
        await ctx.setState({ data: { recorded: true } });
      },
    })
    .build();

/** Declares a hook of the same name as the order handler's, of another type. */
export const ticketCountingHandler = () =>
  setupArvoEventHandler({
    contracts: { self: auditContract },
    types: {} as { mechanismHooks: { ticket: number } },
  })
    .handler('1.0.0', {
      state: z.object({ recorded: z.boolean() }),
      execute: async (ctx) => {
        await ctx.setState({ data: { recorded: true } });
      },
    })
    .build();
