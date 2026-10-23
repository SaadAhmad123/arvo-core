import { describe, expect, it } from 'vitest';
import { createArvoEventFactory } from '../../../src/factories/ArvoEventFactory/index.js';
import { openedPerExecution } from '../dependency.js';
import { ArvoLattice, chanceFrom } from '../version/scenarios/lattice.js';
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

const seededLattice = (seed: number) =>
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

const openingFields = (subject: string) => ({
  source: 'com.web.checkout',
  subject,
  to: fulfilContract.type,
});

/** One order at each of the three versions, so routing is under chaos too. */
const seededOrders = (seed: number) => [
  createArvoEventFactory(fulfilV1).createInput({
    ...openingFields(`order-${seed}-first`),
    data: { items: ['book'] },
  }),
  createArvoEventFactory(fulfilV11).createInput({
    ...openingFields(`order-${seed}-second`),
    data: { items: ['book'], rush: true },
  }),
  createArvoEventFactory(fulfilV2).createInput({
    ...openingFields(`order-${seed}-third`),
    data: { items: ['book'] },
  }),
];

describe('two hundred seeded runs, every one placed by the handler', () => {
  it('holds every invariant under repetition, disorder and loss', async () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const lattice = seededLattice(seed);
      for (const order of seededOrders(seed)) lattice.publish(order);
      await lattice.settle();
      // a crash before publishing can happen again on the commit that
      // recovery produces, so recovery is not one act
      while (lattice.holding > 0) await lattice.recover().settle();

      try {
        await checkHandlerInvariants(lattice);
      } catch (error_) {
        throw new Error(
          `seed ${seed} broke an invariant: ${(error_ as Error).message}`,
        );
      }
    }
  }, 120_000);

  it('routes every execution to the version its own event named, however badly it went', async () => {
    for (let seed = 201; seed <= 260; seed += 1) {
      const lattice = seededLattice(seed);
      for (const order of seededOrders(seed)) lattice.publish(order);
      await lattice.settle();
      // a crash before publishing can happen again on the commit that
      // recovery produces, so recovery is not one act
      while (lattice.holding > 0) await lattice.recover().settle();

      const versionsBySubject = new Map<string, Set<string>>();
      for (const row of lattice.store.values()) {
        if (row.source !== fulfilContract.type) continue;
        const subjectVersions =
          versionsBySubject.get(String(row.subject)) ?? new Set<string>();
        subjectVersions.add(String(row.version));
        versionsBySubject.set(String(row.subject), subjectVersions);
      }

      for (const [subject, versions] of versionsBySubject) {
        expect([...versions], `seed ${seed}, ${subject}`).toHaveLength(1);
      }
    }
  }, 120_000);
});

describe('what chance must never produce', () => {
  it('never a workflow answered twice, however many repeats there were', async () => {
    for (let seed = 301; seed <= 340; seed += 1) {
      const lattice = seededLattice(seed);
      for (const order of seededOrders(seed)) lattice.publish(order);
      await lattice.settle();
      // a crash before publishing can happen again on the commit that
      // recovery produces, so recovery is not one act
      while (lattice.holding > 0) await lattice.recover().settle();

      const answersToCaller = lattice.transcript.published.filter(
        (event) =>
          event.to === 'com.web.checkout' &&
          lattice.transcript.fromExecutions.has(event.id),
      );
      const answerCountBySubject = new Map<string, number>();
      for (const event of answersToCaller) {
        answerCountBySubject.set(
          event.subject,
          (answerCountBySubject.get(event.subject) ?? 0) + 1,
        );
      }
      for (const [subject, count] of answerCountBySubject) {
        expect(count, `seed ${seed}, ${subject} answered ${count} times`).toBe(
          1,
        );
      }
    }
  }, 120_000);
});

describe('what a mechanism supplies, under the same chance', () => {
  /**
   * A lattice whose supplied inputs misbehave as often as its transport
   * does: a store that cannot be read, a factory that cannot build, and
   * hooks that are not what anything expected.
   */
  const latticeWithFailingSupplies = (seed: number) => {
    const chance = chanceFrom(seed);
    const handler = declareHandler();
    const failureCounts = { reads: 0, builds: 0 };

    const lattice = new ArvoLattice({
      versions: {},
      handlers: {
        [fulfilContract.type]: {
          execute: (param: {
            event: unknown;
            state: (stateQuery: { executionId: string }) => unknown;
            attempt: number;
          }) =>
            handler.execute({
              event: param.event as never,
              // a store that is sometimes unreachable
              state: (stateQuery) => {
                if (chance() < 0.15) {
                  failureCounts.reads += 1;
                  throw new Error('the store is unreachable');
                }
                return param.state(stateQuery) as never;
              },
              attempt: param.attempt,
              // a dependency that sometimes cannot open
              dependencies: openedPerExecution(() => {
                if (chance() < 0.15) {
                  failureCounts.builds += 1;
                  throw new Error('the pool is exhausted');
                }
                return {};
              }).dependency,
              // and hooks that are whatever this mechanism felt like
              hooks: (chance() < 0.3
                ? undefined
                : { whatever: chance() }) as never,
            }),
        } as never,
        [inventoryV1.type]: declareInventoryWorker() as never,
        [paymentV1.type]: declarePaymentWorker() as never,
      },
      seed,
      chaos: { duplicate: 0.2, shuffle: true, loseRace: 0.1 },
    });

    return { lattice, failureCounts };
  };

  it('holds every invariant while the store and the factory keep failing', async () => {
    for (let seed = 401; seed <= 460; seed += 1) {
      const { lattice } = latticeWithFailingSupplies(seed);
      for (const order of seededOrders(seed)) lattice.publish(order);
      await lattice.settle();
      while (lattice.holding > 0) await lattice.recover().settle();

      try {
        await checkHandlerInvariants(lattice);
      } catch (error_) {
        throw new Error(
          `seed ${seed} broke an invariant: ${(error_ as Error).message}`,
        );
      }
    }
  }, 120_000);

  it('reads every failure to build as one worth trying again', async () => {
    let sawBuildFailure = false;
    for (let seed = 501; seed <= 560; seed += 1) {
      const { lattice } = latticeWithFailingSupplies(seed);
      for (const order of seededOrders(seed)) lattice.publish(order);
      await lattice.settle();
      while (lattice.holding > 0) await lattice.recover().settle();

      for (const { fault } of lattice.transcript.faults) {
        if (
          fault.faultKind !== 'dependency_resolution_failed' &&
          fault.faultKind !== 'state_resolution_failed'
        ) {
          continue;
        }
        sawBuildFailure = true;
        // in prospect only while there is budget left, which is the one
        // rule about retrying that is pinned rather than chosen
        if (fault.retry !== null) {
          expect(fault.attempt, `seed ${seed}`).toBeLessThan(
            fault.retry.maxRetryAttemptsAllowed,
          );
          expect(fault.retry.retryAt, `seed ${seed}`).toBe(
            fault.timestamp + fault.retry.retryInMs,
          );
        }
      }
    }
    expect(sawBuildFailure, 'nothing failed to build in any run').toBe(true);
  }, 120_000);

  it('never lets what a mechanism supplied reach a record', async () => {
    for (let seed = 601; seed <= 640; seed += 1) {
      const { lattice } = latticeWithFailingSupplies(seed);
      for (const order of seededOrders(seed)) lattice.publish(order);
      await lattice.settle();
      while (lattice.holding > 0) await lattice.recover().settle();

      for (const row of lattice.store.values()) {
        expect(
          JSON.stringify(row),
          `seed ${seed} stored something a mechanism supplied`,
        ).not.toContain('whatever');
      }
    }
  }, 120_000);
});
