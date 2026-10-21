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
const createLayerWatch = () => {
  const observations = {
    supplied: 0,
    tenants: [] as { subject: string; tenant: unknown }[],
    timed: 0,
  };

  const tenantLayer: IArvoEventHandlerMiddleware = {
    id: 'tenant',
    before: (ctx) =>
      ctx.setMiddleware('tenant', `tenant-of-${ctx.state.subject}`),
    after: (ctx) => {
      observations.tenants.push({
        subject: ctx.state.subject,
        tenant: ctx.middleware.tenant,
      });
    },
  };

  const stopwatchFactory = () => {
    let startedAt = 0;
    return {
      id: 'stopwatch',
      before: () => {
        startedAt = performance.now();
      },
      after: () => {
        if (performance.now() >= startedAt) observations.timed += 1;
      },
    } satisfies IArvoEventHandlerMiddleware;
  };

  const suppliedLayer: IArvoEventHandlerMiddleware = {
    id: 'harness',
    before: (_ctx: ArvoExecutionContext) => {
      observations.supplied += 1;
    },
  };

  return {
    seen: observations,
    declared: [tenantLayer, stopwatchFactory],
    supplied: [suppliedLayer],
  };
};

const latticeWithLayers = (
  layerWatch: ReturnType<typeof createLayerWatch>,
  options: { chaos?: boolean; seed?: number } = {},
) =>
  new ArvoLattice({
    versions: {},
    handlers: {
      [fulfilContract.type]: declareHandler({
        middleware: layerWatch.declared,
      }) as never,
      [inventoryV1.type]: declareInventoryWorker() as never,
      [paymentV1.type]: declarePaymentWorker() as never,
    },
    middleware: layerWatch.supplied,
    ...(options.chaos
      ? { chaos: { duplicate: 0.2, shuffle: true, loseRace: 0.1 } }
      : {}),
    ...(options.seed === undefined ? {} : { seed: options.seed }),
  });

const orderFactories = [
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
    const layerWatch = createLayerWatch();
    const lattice = latticeWithLayers(layerWatch);
    for (let orderIndex = 0; orderIndex < 9; orderIndex += 1) {
      lattice.publish(
        orderFactories[orderIndex % 3]?.(`order-${orderIndex}`) as never,
      );
    }
    await lattice.settle();

    expect(lattice.transcript.faults).toEqual([]);
    await checkHandlerInvariants(lattice);
    expect(layerWatch.seen.tenants.length).toBeGreaterThan(0);
    for (const { subject, tenant: tenantLayer } of layerWatch.seen.tenants) {
      expect(tenantLayer).toBe(`tenant-of-${subject}`);
    }
    expect(layerWatch.seen.timed).toBe(layerWatch.seen.tenants.length);
    expect(layerWatch.seen.supplied).toBeGreaterThanOrEqual(
      layerWatch.seen.tenants.length,
    );
  });

  it.each([1, 7, 42])(
    'holds every invariant under chaos, seed %i',
    async (seed) => {
      const layerWatch = createLayerWatch();
      const lattice = latticeWithLayers(layerWatch, { chaos: true, seed });
      for (let orderIndex = 0; orderIndex < 12; orderIndex += 1) {
        lattice.publish(
          orderFactories[orderIndex % 3]?.(
            `order-${seed}-${orderIndex}`,
          ) as never,
        );
      }
      await lattice.settle();

      await checkHandlerInvariants(lattice);
      for (const { subject, tenant: tenantLayer } of layerWatch.seen.tenants) {
        expect(tenantLayer).toBe(`tenant-of-${subject}`);
      }
    },
  );
});
