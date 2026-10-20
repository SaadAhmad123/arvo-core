import { describe, expect, it } from 'vitest';
import type { ArvoExecutionContext } from '../../../src/ArvoEventHandler/context/index.js';
import type { IArvoEventHandlerMiddleware } from '../../../src/ArvoEventHandler/types/middleware.js';
import { createArvoEventFactory } from '../../../src/factories/ArvoEventFactory/index.js';
import { ArvoLattice } from '../version/scenarios/lattice.js';
import {
  declareHandler,
  declareInventoryWorker,
  declarePaymentWorker,
  fulfilContract,
  fulfilV1,
  fulfilV2,
  fulfilV11,
  inventoryV1,
  paymentV1,
} from './fixture.js';
import { checkHandlerInvariants } from './invariants.js';

/**
 * Layers across the three-version handler, driven by a lattice.
 *
 * The handler declares a tenant layer and a layer made per execution; the
 * lattice supplies one more, as a mechanism would. Everything the other
 * scenarios assert must still hold, under chaos as well as without.
 */

/** Records every layer part that ran, and what it saw. */
const watching = () => {
  const seen = {
    supplied: 0,
    tenants: [] as { subject: string; tenant: unknown }[],
    timed: 0,
  };

  const tenant: IArvoEventHandlerMiddleware = {
    id: 'tenant',
    before: (ctx) =>
      ctx.setMiddleware('tenant', `tenant-of-${ctx.state.subject}`),
    after: (ctx) => {
      seen.tenants.push({
        subject: ctx.state.subject,
        tenant: ctx.middleware.tenant,
      });
    },
  };

  const stopwatch = () => {
    let startedAt = 0;
    return {
      id: 'stopwatch',
      before: () => {
        startedAt = performance.now();
      },
      after: () => {
        if (performance.now() >= startedAt) seen.timed += 1;
      },
    } satisfies IArvoEventHandlerMiddleware;
  };

  const supplied: IArvoEventHandlerMiddleware = {
    id: 'harness',
    before: (_ctx: ArvoExecutionContext) => {
      seen.supplied += 1;
    },
  };

  return { seen, declared: [tenant, stopwatch], supplied: [supplied] };
};

const latticeWithLayers = (
  watch: ReturnType<typeof watching>,
  options: { chaos?: boolean; seed?: number } = {},
) =>
  new ArvoLattice({
    versions: {},
    handlers: {
      [fulfilContract.type]: declareHandler({
        middleware: watch.declared,
      }) as never,
      [inventoryV1.type]: declareInventoryWorker() as never,
      [paymentV1.type]: declarePaymentWorker() as never,
    },
    middleware: watch.supplied,
    ...(options.chaos
      ? { chaos: { duplicate: 0.2, shuffle: true, loseRace: 0.1 } }
      : {}),
    ...(options.seed === undefined ? {} : { seed: options.seed }),
  });

const orders = [
  (subject: string) =>
    createArvoEventFactory(fulfilV1).createInput({
      source: 'com.web.checkout',
      subject,
      to: fulfilContract.type,
      data: { items: ['book'] },
    }),
  (subject: string) =>
    createArvoEventFactory(fulfilV11).createInput({
      source: 'com.web.checkout',
      subject,
      to: fulfilContract.type,
      data: { items: ['book'], rush: true },
    }),
  (subject: string) =>
    createArvoEventFactory(fulfilV2).createInput({
      source: 'com.web.checkout',
      subject,
      to: fulfilContract.type,
      data: { items: ['book'] },
    }),
];

describe('layers around the three-version handler', () => {
  it('carries every order through, at every version, each layer seeing its own execution', async () => {
    const watch = watching();
    const lattice = latticeWithLayers(watch);
    for (let at = 0; at < 9; at += 1) {
      lattice.publish(orders[at % 3]?.(`order-${at}`) as never);
    }
    await lattice.settle();

    expect(lattice.transcript.faults).toEqual([]);
    await checkHandlerInvariants(lattice);
    expect(watch.seen.tenants.length).toBeGreaterThan(0);
    for (const { subject, tenant } of watch.seen.tenants) {
      expect(tenant).toBe(`tenant-of-${subject}`);
    }
    expect(watch.seen.timed).toBe(watch.seen.tenants.length);
    expect(watch.seen.supplied).toBeGreaterThanOrEqual(
      watch.seen.tenants.length,
    );
  });

  it.each([1, 7, 42])(
    'holds every invariant under chaos, seed %i',
    async (seed) => {
      const watch = watching();
      const lattice = latticeWithLayers(watch, { chaos: true, seed });
      for (let at = 0; at < 12; at += 1) {
        lattice.publish(orders[at % 3]?.(`order-${seed}-${at}`) as never);
      }
      await lattice.settle();

      await checkHandlerInvariants(lattice);
      for (const { subject, tenant } of watch.seen.tenants) {
        expect(tenant).toBe(`tenant-of-${subject}`);
      }
    },
  );
});
