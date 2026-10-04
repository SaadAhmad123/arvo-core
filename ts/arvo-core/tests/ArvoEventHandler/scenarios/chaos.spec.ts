import { describe, expect, it } from 'vitest';
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
 * Seeded chance, with the handler deciding everything.
 *
 * The named scenarios are the cases a person thought of. This explores
 * the space between them: events repeated, reordered, dropped, lost on
 * the way to a store and lost on the way out of one, with the handler
 * placing every one of them.
 *
 * Every run is seeded, so a failure is a seed rather than a story, and
 * the seed is printed where one fails.
 */

const latticeFor = (seed: number) =>
  new ArvoLattice({
    versions: {},
    handlers: {
      [fulfilContract.type]: declareHandler() as never,
      [inventoryV1.type]: declareInventoryWorker() as never,
      [paymentV1.type]: declarePaymentWorker() as never,
    },
    seed,
    chaos: {
      duplicate: 0.3,
      shuffle: true,
      crashBeforePublish: 0.1,
      loseRace: 0.1,
      crashMidExecution: 0.1,
    },
  });

const opening = (subject: string) => ({
  source: 'com.web.checkout',
  subject,
  to: fulfilContract.type,
});

/** One order at each of the three versions, so routing is under chaos too. */
const ordersFor = (run: number) => [
  createArvoEventFactory(fulfilV1).createInput({
    ...opening(`order-${run}-first`),
    data: { items: ['book'] },
  }),
  createArvoEventFactory(fulfilV11).createInput({
    ...opening(`order-${run}-second`),
    data: { items: ['book'], rush: true },
  }),
  createArvoEventFactory(fulfilV2).createInput({
    ...opening(`order-${run}-third`),
    data: { items: ['book'] },
  }),
];

describe('two hundred seeded runs, every one placed by the handler', () => {
  it('holds every invariant under repetition, disorder and loss', async () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const lattice = latticeFor(seed);
      for (const order of ordersFor(seed)) lattice.publish(order);
      await lattice.settle();
      // a crash before publishing can happen again on the commit that
      // recovery produces, so recovery is not one act
      while (lattice.holding > 0) await lattice.recover().settle();

      try {
        await checkHandlerInvariants(lattice);
      } catch (broke) {
        throw new Error(
          `seed ${seed} broke an invariant: ${(broke as Error).message}`,
        );
      }
    }
  }, 120_000);

  it('routes every execution to the version its own event named, however badly it went', async () => {
    for (let seed = 201; seed <= 260; seed += 1) {
      const lattice = latticeFor(seed);
      for (const order of ordersFor(seed)) lattice.publish(order);
      await lattice.settle();
      // a crash before publishing can happen again on the commit that
      // recovery produces, so recovery is not one act
      while (lattice.holding > 0) await lattice.recover().settle();

      const byVersion = new Map<string, Set<string>>();
      for (const row of lattice.store.values()) {
        if (row.source !== fulfilContract.type) continue;
        const held = byVersion.get(String(row.subject)) ?? new Set<string>();
        held.add(String(row.version));
        byVersion.set(String(row.subject), held);
      }

      for (const [subject, versions] of byVersion) {
        expect([...versions], `seed ${seed}, ${subject}`).toHaveLength(1);
      }
    }
  }, 120_000);
});

describe('what chance must never produce', () => {
  it('never a workflow answered twice, however many repeats there were', async () => {
    for (let seed = 301; seed <= 340; seed += 1) {
      const lattice = latticeFor(seed);
      for (const order of ordersFor(seed)) lattice.publish(order);
      await lattice.settle();
      // a crash before publishing can happen again on the commit that
      // recovery produces, so recovery is not one act
      while (lattice.holding > 0) await lattice.recover().settle();

      const answered = lattice.transcript.published.filter(
        (event) =>
          event.to === 'com.web.checkout' &&
          lattice.transcript.fromExecutions.has(event.id),
      );
      const bySubject = new Map<string, number>();
      for (const event of answered) {
        bySubject.set(event.subject, (bySubject.get(event.subject) ?? 0) + 1);
      }
      for (const [subject, count] of bySubject) {
        expect(count, `seed ${seed}, ${subject} answered ${count} times`).toBe(
          1,
        );
      }
    }
  }, 120_000);
});
