/**
 * A handler implements one contract and declares what it may send to. Every
 * version the contract holds needs an executor, and the whole declaration is
 * judged in one go.
 */

import {
  ArvoEventHandlerValidationError,
  createArvoContract,
  setupArvoEventHandler,
} from 'arvo-core';
import { z } from 'zod';
import { type Chapter, heading } from '../display.js';

const payments = createArvoContract({
  type: 'com_payment_charge',
  versions: {
    '1.0.0': {
      input: z.object({ amount: z.number() }),
      outputs: { evt_payment_charged: z.object({ receipt: z.string() }) },
    },
  },
});

const orders = createArvoContract({
  type: 'com_order_fulfil',
  versions: {
    '1.0.0': {
      input: z.object({ items: z.array(z.string()) }),
      outputs: { evt_order_fulfilled: z.object({ order_id: z.string() }) },
    },
    '1.1.0': {
      input: z.object({ items: z.array(z.string()), rush: z.boolean() }),
      outputs: { evt_order_fulfilled: z.object({ order_id: z.string() }) },
    },
    '2.0.0': {
      input: z.object({ items: z.array(z.string()) }),
      outputs: { evt_order_shipped: z.object({ tracking: z.string() }) },
    },
  },
});

/** One chain: where it starts, one call per version, and what it returns. */
const theChain = (): void => {
  heading('declaring a handler');

  const handler = setupArvoEventHandler({
    contracts: {
      self: orders,
      services: { payments: payments.versions['1.0.0'] },
    },
    // what every version falls back to
    options: { maxRetryAttempts: 5 },
  })
    .handler('1.0.0', {
      state: z.object({ stage: z.string() }),
      options: { maxDepth: 250 },
      execute: async (ctx) => {
        if (ctx.entry === 'followup') {
          await ctx.setState({ data: { stage: 'answering' } });
          return ctx.build({
            type: 'evt_order_fulfilled',
            data: { order_id: ctx.state.subject },
          });
        }
        await ctx.setState({ data: { stage: 'asking' } });
        return ctx.build({ type: 'com_payment_charge', data: { amount: 10 } });
      },
    })
    .handler('1.1.0', {
      state: z.object({ stage: z.string(), rush: z.boolean() }),
      execute: async (ctx) => {
        await ctx.setState({ data: { stage: 'asking', rush: true } });
        return ctx.build({ type: 'com_payment_charge', data: { amount: 20 } });
      },
    })
    // the executor alone, for a version that remembers nothing and
    // inherits every option
    .handler('2.0.0', async (ctx) =>
      ctx.build({
        type: 'evt_order_shipped',
        data: { tracking: `t-${ctx.state.subject}` },
      }),
    )
    .build();

  console.log('  implements:', handler.contracts.self.type);
  console.log('  may send to:', Object.keys(handler.contracts.services));
  console.log('  versions:', [...handler.versions.keys()]);
};

/** Options settle per version, and are read where a version is read. */
const optionsPerVersion = (): void => {
  heading('what each version runs under');

  const handler = setupArvoEventHandler({
    contracts: { self: orders },
    options: { maxRetryAttempts: 5, runTimeout: 10_000 },
  })
    .handler('1.0.0', {
      options: { maxDepth: 250 },
      execute: async () => {},
    })
    .handler('1.1.0', async () => {})
    .handler('2.0.0', async () => {})
    .build();

  const first = handler.versions.get('1.0.0').options;
  const second = handler.versions.get('1.1.0').options;

  console.log('  1.0.0 maxDepth (its own):', first.maxDepth);
  console.log('  1.1.0 maxDepth (inherited):', second.maxDepth);
  console.log('  1.1.0 maxRetryAttempts (the handler’s):', second.maxRetryAttempts);
  console.log('  1.1.0 collect (the protocol’s):', second.collect);
};

/**
 * A declaration that cannot work is refused before any event exists, and the
 * error names every rule it broke rather than the first.
 */
const refused = (): void => {
  heading('a declaration that cannot work');

  try {
    setupArvoEventHandler({
      contracts: { self: orders },
      options: { maxDepth: -1 },
    })
      // 1.1.0 and 2.0.0 are left without an executor on purpose
      .handler('1.0.0', async () => {})
      .build();
  } catch (raised) {
    if (!(raised instanceof ArvoEventHandlerValidationError)) throw raised;
    for (const issue of raised.issues) console.log(`  ${issue}`);
  }

  // The reporting twin says the same thing without throwing.
  const reported = setupArvoEventHandler({ contracts: { self: orders } })
    .handler('1.0.0', async () => {})
    .tryBuild();
  console.log('  tryBuild:', reported.ok ? 'ok' : 'reported');
};

export const chapter: Chapter = {
  title: '13. declaring a handler',
  run: () => {
    theChain();
    optionsPerVersion();
    refused();
  },
};
