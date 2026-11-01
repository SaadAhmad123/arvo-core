import { expect } from 'vitest';
import { createCatalogueData } from '../../../src/load/harness/catalogue.js';
import { FakeQueue } from '../../../src/load/harness/fake-queue.js';
import {
  createLatticeDispatcher,
  openingOrder,
} from '../../../src/load/harness/lattice.js';
import {
  type LatticeRunOutcome,
  runLattice,
  type SweeperSettings,
} from '../../../src/load/harness/lattice-run.js';
import { Ledger } from '../../../src/load/harness/ledger.js';
import type { OpenedSubject } from '../../../src/load/harness/subjects.js';

/**
 * One run of orders through the real handlers against an opened outbox,
 * ending on every invariant: answered, nothing lost or doubled, nothing
 * left unseen.
 */
export const runOrders = async (param: {
  readonly subject: OpenedSubject;
  readonly orderCount: number;
  readonly width: number;
  readonly depth: number;
  readonly workerCount: number;
  readonly sweeper?: SweeperSettings | null;
  readonly unsentShare?: number;
  readonly askCapacityFirst?: boolean;
  readonly deadlineMs?: number;
  readonly seed?: number;
}): Promise<LatticeRunOutcome> => {
  const queue = new FakeQueue();
  const ledger = new Ledger();
  queue.publish(
    Array.from({ length: param.orderCount }, (_unused, orderNumber) =>
      openingOrder({
        orderRef: `ORD-${crypto.randomUUID().slice(0, 8)}-${orderNumber}`,
        width: param.width,
        depth: param.depth,
      }),
    ),
  );
  const outcome = await runLattice({
    driver: param.subject.driver,
    dispatcher: createLatticeDispatcher(),
    catalogueData: createCatalogueData({
      itemCount: Math.max(param.width, 1),
      walkDepth: param.depth + 1,
    }),
    ledger,
    queue,
    workerCount: param.workerCount,
    sweeper:
      param.sweeper === undefined
        ? { intervalMs: 50, olderThanMs: 200, atMost: 500, leaseMs: 5000 }
        : param.sweeper,
    unsentShare: param.unsentShare ?? 0.05,
    askCapacityFirst: param.askCapacityFirst ?? true,
    deadlineMs: param.deadlineMs ?? 3 * 60 * 1000,
    seed: param.seed ?? 7,
  });
  expect(
    outcome.finished,
    `the run finished before its deadline: ${JSON.stringify(outcome)}`,
  ).toBe(true);
  expect(outcome.answeredOrders).toBe(param.orderCount);
  expect(await ledger.problems(param.subject.driver)).toEqual([]);
  return outcome;
};
