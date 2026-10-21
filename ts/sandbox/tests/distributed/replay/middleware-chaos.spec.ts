import type { ArvoEvent } from 'arvo-core';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { DeliveryScope } from '../../../src/distributed/replay/delivery.js';
import { runOneWorkflow } from '../../../src/distributed/replay/loop.js';
import { readConfig } from '../../../src/distributed/shared/config.js';
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
  tallyOf,
  walkDiscrepanciesOf,
  walkFailuresOf,
} from '../shared/chaos.js';
import { endingUnderReplay } from '../shared/chaos-endings.js';

/**
 * Task 7.5 under the plain loop: many workflows at once, each with a
 * failure of its own injected through a layer.
 *
 * The control. No framework retries here and nothing waits out a delay,
 * so every ending is the handler's and the record store's alone.
 *
 * Needs the stack up and migrated.
 */

/** How many workflows run at once. */
const WORKFLOWS = 40;

/** What every plan in this file is drawn from; in the suite's name, so every report carries it. */
const seed = chaosSeed('replay');

describe(`layers under chaos, under the plain loop (CHAOS_SEED=${seed})`, () => {
  let pool: Pool;
  let scope: DeliveryScope;

  beforeAll(async () => {
    const config = readConfig('arvo-replay-middleware-chaos-spec');
    pool = new Pool({
      connectionString: config.recordsUrl,
      max: config.recordsPoolSize,
    });
    scope = { store: storeFor(pool), pool };
    await stockTheChaosShelf(pool);
  }, 120_000);

  afterEach(() => injectFailuresBySubject(null));

  afterAll(async () => {
    await pool?.end();
  });

  /** One workflow, run to its end, and where its opening execution rests. */
  const runToTheEnd = (event: ArvoEvent) => endingUnderReplay(scope, event);

  it(`ends ${WORKFLOWS} workflows at once where the protocol says, whatever each layer does`, async () => {
    const plan = planChaos({ seed, count: WORKFLOWS, label: 'replay' });
    console.info(`[middleware chaos] replay plan: ${tallyOf(plan)}`);
    injectFailuresBySubject(failuresOf(plan));

    const endings = await Promise.all(
      plan.map(({ event }) => runToTheEnd(event)),
    );

    expect(
      await discrepanciesAcross(plan, endings),
      `CHAOS_SEED=${seed}`,
    ).toEqual([]);
    expect(layerTamperingsThatTookEffect(), `CHAOS_SEED=${seed}`).toEqual([]);
  }, 180_000);

  it('ends every workflow where the protocol says while the way to make a layer fails intermittently', async () => {
    const plan = planChaos({
      seed: seed + 1,
      count: 24,
      label: 'replay-factory',
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
      aChaosWalk(`replay-${position}`),
    );
    injectFailuresBySubject(walkFailuresOf(walks));

    const found = await Promise.all(
      walks.map(async (walk) => {
        const outcome = await runOneWorkflow(scope, walk);
        return walkDiscrepanciesOf(walk, outcome.kind, outcome.events);
      }),
    );

    expect(found.flat()).toEqual([]);
  }, 180_000);
});
