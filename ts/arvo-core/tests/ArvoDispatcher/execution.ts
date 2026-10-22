import type { Tracer } from '@opentelemetry/api';
import { z } from 'zod';
import type { IArvoEventHandlerMiddleware } from '../../src/ArvoEventHandler/types/middleware.js';
import { createArvoEventFactory } from '../../src/factories/ArvoEventFactory/index.js';
import { setupArvoEventHandler } from '../../src/factories/setupArvoEventHandler.js';
import type { JSONObject } from '../../src/types.js';
import {
  orderContract,
  orderVersion,
  paymentContract,
  paymentVersion,
} from '../ArvoEventHandler/fixtures.js';

/** The span every dispatcher call opens. */
export const DISPATCHER_SPAN = 'arvo.dispatcher.execute';

/** A store the handler reads through, as a runtime would supply one. */
export const fakeStore = () => {
  const rows = new Map<string, JSONObject>();
  return {
    rows,
    read:
      () =>
      ({ executionId }: { executionId: string }) =>
        rows.get(executionId) ?? null,
  };
};

/** An event opening an execution of the order handler. */
export const orderRequest = (
  param: { subject?: string; to?: string; traceparent?: string } = {},
) =>
  createArvoEventFactory(orderVersion).createInput({
    source: 'com.web.checkout',
    subject: param.subject ?? 'order-1',
    to: param.to ?? orderVersion.type,
    data: { items: ['book'] },
    ...(param.traceparent === undefined
      ? {}
      : { traceparent: param.traceparent }),
  });

/** A trace context to continue, as an event arriving from elsewhere carries. */
export const CALLER_TRACEPARENT = `00-${'c'.repeat(32)}-${'d'.repeat(16)}-01`;

/** What one execution of a handler under test saw. */
export type Seen = { dependency: string | null; hooks: string | null };

/**
 * An order handler that records what it was given and asks for a payment.
 * Declares a dependency and a hook, and optionally a layer of its own.
 */
export const orderHandlerUnderTest = (
  param: {
    tracer?: Tracer;
    seen?: Seen[];
    middleware?: readonly IArvoEventHandlerMiddleware[];
  } = {},
) =>
  setupArvoEventHandler({
    contracts: { self: orderContract, services: { payments: paymentVersion } },
    types: {} as {
      dependencies: { orders: string };
      mechanismHooks: { ticket: string };
    },
    ...(param.tracer === undefined
      ? {}
      : { telemetry: { tracer: param.tracer } }),
    ...(param.middleware === undefined ? {} : { middleware: param.middleware }),
  })
    .handler('1.0.0', {
      state: z.object({ stage: z.string() }),
      execute: async (ctx) => {
        param.seen?.push({
          dependency: ctx.dependencies?.orders ?? null,
          hooks: ctx.hooks?.ticket ?? null,
        });
        await ctx.setState({ data: { stage: 'asking' } });
        return ctx.build({ type: 'com_payment_charge', data: { amount: 10 } });
      },
    })
    .build();

/** A payment handler, with a dependency of its own. */
export const paymentHandlerUnderTest = (param: { tracer?: Tracer } = {}) =>
  setupArvoEventHandler({
    contracts: { self: paymentContract },
    types: {} as { dependencies: { ledger: number } },
    ...(param.tracer === undefined
      ? {}
      : { telemetry: { tracer: param.tracer } }),
  })
    .handler('1.0.0', {
      state: z.object({ charged: z.boolean() }),
      execute: async (ctx) => {
        await ctx.setState({ data: { charged: true } });
      },
    })
    .build();

/** A dependency that holds nothing and exposes one value. */
export const dependencyExposing = <TAttributes extends Record<string, unknown>>(
  attributes: TAttributes,
) => ({
  attributes,
  open: () => undefined,
  close: () => undefined,
});
