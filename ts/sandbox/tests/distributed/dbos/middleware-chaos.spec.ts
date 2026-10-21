import type { ArvoEvent } from 'arvo-core';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { startRun } from '../../../src/distributed/dbos/client.js';
import {
  injectFailuresBySubject,
  layerTamperingsThatTookEffect,
} from '../../../src/distributed/shared/delivery-middleware.js';
import { storeFor } from '../../../src/distributed/shared/record-store.js';
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
import { endingUnderDbos } from '../shared/chaos-endings.js';
import { type DbosHarness, startDbosHarness } from './harness.js';

/**
 * Task 7.5 under DBOS: many workflows at once, each with a failure of
 * its own injected through a layer, retried by DBOS inside the step.
 *
 * No worker is stopped here. The harness runs DBOS in the test process,
 * and DBOS can be launched once per process: a second launch refuses to
 * register the workflows again, and a step still running when DBOS
 * shuts down fails on the pool the shutdown ended — which is the
 * harness ending, not anything a layer did. Stopping a DBOS worker
 * mid-chain needs it in a process of its own.
 *
 * Needs the stack up and migrated.
 */

/** How many workflows run at once. */
const WORKFLOWS = 40;

/** What every plan in this file is drawn from; in the suite's name, so every report carries it. */
const seed = chaosSeed('dbos');

describe(`layers under chaos, under DBOS (CHAOS_SEED=${seed})`, () => {
  let harness: DbosHarness;

  beforeAll(async () => {
    harness = await startDbosHarness('arvo-dbos-middleware-chaos-spec');
    await stockTheChaosShelf(harness.pool);
  }, 120_000);

  afterEach(() => injectFailuresBySubject(null));

  afterAll(async () => {
    await harness?.stop();
  }, 60_000);

  /** One workflow, run to its end, and where its opening execution rests. */
  const runToTheEnd = (event: ArvoEvent) =>
    endingUnderDbos(
      { workflows: harness.workflows, store: storeFor(harness.pool) },
      event,
    );

  it(`ends ${WORKFLOWS} workflows at once where the protocol says, whatever each layer does`, async () => {
    const plan = planChaos({ seed, count: WORKFLOWS, label: 'dbos' });
    injectFailuresBySubject(failuresOf(plan));

    const endings = await Promise.all(
      plan.map(({ event }) => runToTheEnd(event)),
    );

    expect(
      await discrepanciesAcross(plan, endings),
      `CHAOS_SEED=${seed}`,
    ).toEqual([]);
    expect(layerTamperingsThatTookEffect(), `CHAOS_SEED=${seed}`).toEqual([]);
  }, 240_000);

  it('ends every workflow where the protocol says while the way to make a layer fails intermittently', async () => {
    const plan = planChaos({
      seed: seed + 1,
      count: 24,
      label: 'dbos-factory',
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
      aChaosWalk(`dbos-${position}`),
    );
    injectFailuresBySubject(walkFailuresOf(walks));

    const found = await Promise.all(
      walks.map(async (walk) => {
        const outcome = await startRun(harness.workflows, walk);
        return walkDiscrepanciesOf(walk, outcome.kind, outcome.events);
      }),
    );

    expect(found.flat()).toEqual([]);
  }, 240_000);
});
