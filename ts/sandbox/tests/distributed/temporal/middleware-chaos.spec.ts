import type { ArvoEvent } from 'arvo-core';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  injectFailuresBySubject,
  layerTamperingsThatTookEffect,
  slowBeforePartsEnteredSoFar,
} from '../../../src/distributed/shared/delivery-middleware.js';
import { startRun } from '../../../src/distributed/temporal/client.js';
import type { RunOutcome } from '../../../src/distributed/temporal/protocol.js';
import {
  aChaosWalk,
  chaosSeed,
  discrepanciesAcross,
  failuresOf,
  INTERMITTENT_FACTORY_CASES,
  planChaos,
  stockTheChaosShelf,
  walkDiscrepanciesOf,
  walkFailuresOf,
} from '../shared/chaos.js';
import {
  endingUnderTemporal,
  publishedByTemporal,
} from '../shared/chaos-endings.js';
import { startTemporalHarness, type TemporalHarness } from './harness.js';

/**
 * Task 7.5 under Temporal: many workflows at once, each with a failure
 * of its own injected through a layer, retried by Temporal with the
 * delay each fault asks for.
 *
 * Temporal keeps a run on the cluster rather than in the worker, so this
 * is also where a worker is stopped mid-chain and a fresh one carries on:
 * the harness can be stopped and started again in one process, and the
 * runs it was carrying wait on the cluster in between.
 *
 * Needs the cluster up and the handlers' store migrated.
 */

/** How many workflows run at once. */
const WORKFLOWS = 40;

/** What every plan in this file is drawn from; in the suite's name, so every report carries it. */
const seed = chaosSeed('temporal');

describe(`layers under chaos, under Temporal (CHAOS_SEED=${seed})`, () => {
  let harness: TemporalHarness;

  beforeAll(async () => {
    harness = await startTemporalHarness('arvo-temporal-middleware-chaos-spec');
    await stockTheChaosShelf(harness.pool);
  }, 120_000);

  afterEach(() => injectFailuresBySubject(null));

  afterAll(async () => {
    await harness?.stop();
  }, 120_000);

  /** One workflow, run to its end, and where its opening execution rests. */
  const runToTheEnd = (event: ArvoEvent) =>
    endingUnderTemporal(harness.client, event);

  it(`ends ${WORKFLOWS} workflows at once where the protocol says, whatever each layer does`, async () => {
    const plan = planChaos({ seed, count: WORKFLOWS, label: 'temporal' });
    injectFailuresBySubject(failuresOf(plan));

    const endings = await Promise.all(
      plan.map(({ event }) => runToTheEnd(event)),
    );

    expect(
      await discrepanciesAcross(plan, endings),
      `CHAOS_SEED=${seed}`,
    ).toEqual([]);
    expect(layerTamperingsThatTookEffect(), `CHAOS_SEED=${seed}`).toEqual([]);
  }, 300_000);

  it('ends every workflow where the protocol says while the way to make a layer fails intermittently', async () => {
    const plan = planChaos({
      seed: seed + 1,
      count: 24,
      label: 'temporal-factory',
      cases: INTERMITTENT_FACTORY_CASES,
    });
    injectFailuresBySubject(failuresOf(plan));

    const endings = await Promise.all(
      plan.map(({ event }) => runToTheEnd(event)),
    );

    expect(
      await discrepanciesAcross(plan, endings),
      `CHAOS_SEED=${seed}`,
    ).toEqual([]);
  }, 180_000);

  it('carries a chain of deliveries through slow, cut and failing layers at every step', async () => {
    const walks = Array.from({ length: 8 }, (_, position) =>
      aChaosWalk(`temporal-${position}`),
    );
    injectFailuresBySubject(walkFailuresOf(walks));

    const found = await Promise.all(
      walks.map(async (walk) => {
        const outcome = await startRun(harness.client, walk);
        return walkDiscrepanciesOf(
          walk,
          outcome.kind,
          publishedByTemporal(outcome),
        );
      }),
    );

    expect(found.flat()).toEqual([]);
  }, 300_000);

  it('finishes every chain on a fresh worker when the worker is stopped mid-chain', async () => {
    // Every delivery of every walk is held in a slow before part, so the
    // stop lands while layers are running. The first worker stops taking
    // work at once; the deliveries it has in flight cannot finish until a
    // record worker is serving again, because a delivery commits through
    // its record's workflow — so the fresh harness is started without
    // waiting for the old one to drain, and the old one drains once it is
    // up. Everything after the deliveries in flight is the fresh worker's.
    const walks = Array.from({ length: 6 }, (_, position) =>
      aChaosWalk(`temporal-stopped-${position}`),
    );
    injectFailuresBySubject(
      new Map(
        walks.map((walk) => [walk.subject, { kind: 'slow_before', ms: 2_000 }]),
      ),
    );

    // The caller's wait belongs to the stopped harness's connection and
    // may die with it; the run does not.
    const firstWaits = walks.map((walk) =>
      startRun(harness.client, walk).catch(() => null),
    );
    await vi.waitFor(
      () =>
        expect(slowBeforePartsEnteredSoFar()).toBeGreaterThanOrEqual(
          walks.length,
        ),
      { timeout: 60_000, interval: 50 },
    );
    const enteredAtTheStop = slowBeforePartsEnteredSoFar();
    const stoppingTheFirstWorker = harness.stop();

    harness = await startTemporalHarness(
      'arvo-temporal-middleware-chaos-spec-restarted',
    );

    const found = await Promise.all(
      walks.map(async (walk) => {
        const outcome: RunOutcome = await harness.client.workflow
          .getHandle(`run-${walk.id}`)
          .result();
        return walkDiscrepanciesOf(
          walk,
          outcome.kind,
          publishedByTemporal(outcome),
        );
      }),
    );
    await stoppingTheFirstWorker;
    await Promise.all(firstWaits);

    expect(found.flat()).toEqual([]);
    // and the chains really were cut: the fresh worker ran layers too
    expect(slowBeforePartsEnteredSoFar()).toBeGreaterThan(enteredAtTheStop);
  }, 300_000);

  it('ends a chaos plan where the protocol says across a worker stopped mid-plan', async () => {
    const plan = planChaos({
      seed: seed + 2,
      count: 24,
      label: 'temporal-stopped-plan',
    });
    injectFailuresBySubject(failuresOf(plan));

    const firstWaits = plan.map(({ event }) =>
      startRun(harness.client, event).catch(() => null),
    );
    // every case is in the plan, the slow before parts among them, so
    // this stops the worker while at least one layer is running
    await vi.waitFor(
      () => expect(slowBeforePartsEnteredSoFar()).toBeGreaterThanOrEqual(1),
      { timeout: 60_000, interval: 20 },
    );
    const stoppingTheFirstWorker = harness.stop();
    harness = await startTemporalHarness(
      'arvo-temporal-middleware-chaos-spec-restarted',
    );

    const endings = await Promise.all(
      plan.map(({ event }) =>
        endingUnderTemporal(harness.client, event, () =>
          harness.client.workflow.getHandle(`run-${event.id}`).result(),
        ),
      ),
    );
    await stoppingTheFirstWorker;
    await Promise.all(firstWaits);

    expect(
      await discrepanciesAcross(plan, endings),
      `CHAOS_SEED=${seed}`,
    ).toEqual([]);
    expect(layerTamperingsThatTookEffect(), `CHAOS_SEED=${seed}`).toEqual([]);
  }, 300_000);
});
