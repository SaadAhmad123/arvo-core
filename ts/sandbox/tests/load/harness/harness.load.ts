import { ArvoOutboxDriver } from 'arvo-core';
import { createArvoMemoryOutbox } from 'arvo-core/outbox/inmemory';
import { afterEach, describe, expect, it } from 'vitest';
import { createCatalogueData } from '../../../src/load/harness/catalogue.js';
import { FakeQueue } from '../../../src/load/harness/fake-queue.js';
import {
  createLatticeDispatcher,
  openingOrder,
} from '../../../src/load/harness/lattice.js';
import { runLattice } from '../../../src/load/harness/lattice-run.js';
import { Ledger } from '../../../src/load/harness/ledger.js';

/** A driver over a new in-memory outbox, opened, closed after the check. */
const openedDrivers: ArvoOutboxDriver[] = [];
const openDriver = async () => {
  const driver = new ArvoOutboxDriver({
    outbox: createArvoMemoryOutbox({
      buffers: {
        events: { size: 100_000, tolerance: 0.2 },
        states: { size: 100_000, tolerance: 0.2 },
      },
    }),
  });
  await driver.open();
  openedDrivers.push(driver);
  return driver;
};

afterEach(async () => {
  for (const driver of openedDrivers.splice(0)) await driver.close();
});

describe('the load harness', () => {
  it('finds an event committed and never handed out', async () => {
    const ledger = new Ledger();
    ledger.recordCommit({
      executionId: 'e',
      casVersion: 0,
      eventIds: ['lost'],
    });
    expect(await ledger.problems(await openDriver())).toEqual([
      'event lost was committed and never handed out',
    ]);
  });

  it('finds a revision that landed twice', async () => {
    const ledger = new Ledger();
    ledger.recordCommit({ executionId: 'e', casVersion: 3, eventIds: [] });
    ledger.recordCommit({ executionId: 'e', casVersion: 3, eventIds: [] });
    expect(await ledger.problems(await openDriver())).toEqual([
      'revision e@3 landed 2 times',
    ]);
  });

  it('finds a listing out of order', async () => {
    const ledger = new Ledger();
    ledger.recordListing([
      '2026-01-02T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
    ]);
    expect(await ledger.problems(await openDriver())).toHaveLength(1);
  });

  it('drives orders through the real handlers to answered, committed, sent and seen', async () => {
    const driver = await openDriver();
    const queue = new FakeQueue();
    const ledger = new Ledger();
    queue.publish(
      Array.from({ length: 5 }, (_unused, orderNumber) =>
        openingOrder({ orderRef: `ORD-${orderNumber}`, width: 5, depth: 2 }),
      ),
    );
    const outcome = await runLattice({
      driver,
      dispatcher: createLatticeDispatcher(),
      catalogueData: createCatalogueData({ itemCount: 20, walkDepth: 3 }),
      ledger,
      queue,
      workerCount: 4,
      sweeper: null,
      unsentShare: 0,
      askCapacityFirst: true,
      deadlineMs: 60_000,
      seed: 1,
    });
    expect(outcome.finished).toBe(true);
    expect(outcome.answeredOrders).toBe(5);
    expect(outcome.givenUp).toBeGreaterThan(0);
    expect(outcome.retries).toBeGreaterThan(0);
    expect(await ledger.problems(driver)).toEqual([]);
    expect(
      await driver.listUnseenEvents({ atMost: 10, olderThanMs: 0 }),
    ).toEqual([]);
  });

  it('sends, through the sweeper, what workers committed and never sent', async () => {
    const driver = await openDriver();
    const queue = new FakeQueue();
    const ledger = new Ledger();
    queue.publish(
      Array.from({ length: 5 }, (_unused, orderNumber) =>
        openingOrder({ orderRef: `ORD-${orderNumber}`, width: 5, depth: 2 }),
      ),
    );
    const outcome = await runLattice({
      driver,
      dispatcher: createLatticeDispatcher(),
      catalogueData: createCatalogueData({ itemCount: 20, walkDepth: 3 }),
      ledger,
      queue,
      workerCount: 4,
      sweeper: { intervalMs: 20, olderThanMs: 0, atMost: 100, leaseMs: 1000 },
      unsentShare: 0.3,
      askCapacityFirst: false,
      deadlineMs: 60_000,
      seed: 2,
    });
    expect(outcome.finished).toBe(true);
    expect(outcome.answeredOrders).toBe(5);
    expect(outcome.sweptEvents).toBeGreaterThan(0);
    expect(await ledger.problems(driver)).toEqual([]);
  });
});
