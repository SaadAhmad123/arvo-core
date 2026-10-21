import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { clearRecords } from '../../../src/distributed/replay/clear.js';
import { injectFailuresBySubject } from '../../../src/distributed/shared/delivery-middleware.js';
import { storeFor } from '../../../src/distributed/shared/record-store.js';
import { type DbosHarness, startDbosHarness } from '../dbos/harness.js';
import {
  chaosSeed,
  comparableEnding,
  discrepanciesAcross,
  failuresOf,
  planChaos,
  stockTheChaosShelf,
  type WorkflowEnding,
} from '../shared/chaos.js';
import {
  endingUnderDbos,
  endingUnderReplay,
  endingUnderTemporal,
} from '../shared/chaos-endings.js';
import {
  startTemporalHarness,
  type TemporalHarness,
} from '../temporal/harness.js';

/**
 * Task 7.5 across mechanisms: one chaos plan — the very same events,
 * each with its failure — run under the plain loop, DBOS and Temporal,
 * and every workflow must come to the same record and publish the same
 * events under all three.
 *
 * Compared as the cross-mechanism replay compares them: what is minted
 * per event set aside, everything decided kept. A layer is no part of
 * the record, so what it did may change where an execution ends only as
 * the protocol says, and identically wherever it ran.
 *
 * The plain loop and DBOS share one record store, so it is cleared
 * between them; Temporal keeps its own.
 *
 * Needs the cluster up, the stack up, and both migrated.
 */

/** What the plan is drawn from; in the suite's name, so every report carries it. */
const seed = chaosSeed('across mechanisms');

describe(`one chaos plan under every mechanism (CHAOS_SEED=${seed})`, () => {
  let temporal: TemporalHarness;
  let dbos: DbosHarness;

  beforeAll(async () => {
    temporal = await startTemporalHarness('arvo-chaos-across-temporal');
    dbos = await startDbosHarness('arvo-chaos-across-dbos');
    await stockTheChaosShelf(dbos.pool);
  }, 240_000);

  afterEach(() => injectFailuresBySubject(null));

  afterAll(async () => {
    await temporal?.stop();
    await dbos?.stop();
  }, 120_000);

  it('ends every workflow at the same record, publishing the same events, under all three', async () => {
    const plan = planChaos({ seed, count: 24, label: 'across' });
    injectFailuresBySubject(failuresOf(plan));
    const store = storeFor(dbos.pool);

    await clearRecords(dbos.pool);
    const underReplay = await Promise.all(
      plan.map(({ event }) =>
        endingUnderReplay({ store, pool: dbos.pool }, event),
      ),
    );

    await clearRecords(dbos.pool);
    const underDbos = await Promise.all(
      plan.map(({ event }) =>
        endingUnderDbos({ workflows: dbos.workflows, store }, event),
      ),
    );

    const underTemporal = await Promise.all(
      plan.map(({ event }) => endingUnderTemporal(temporal.client, event)),
    );

    // each where the protocol says, before any is compared with another
    for (const endings of [underReplay, underDbos, underTemporal]) {
      expect(
        await discrepanciesAcross(plan, endings),
        `CHAOS_SEED=${seed}`,
      ).toEqual([]);
    }

    /** Each workflow's ending, labelled, as two mechanisms can be compared. */
    const comparable = (endings: readonly WorkflowEnding[]) =>
      endings.map((ending, position) => ({
        workflow: `${plan[position]?.event.subject} [${plan[position]?.chaosCase.name}]`,
        ending: comparableEnding(ending),
      }));

    expect(comparable(underDbos), `CHAOS_SEED=${seed}`).toEqual(
      comparable(underReplay),
    );
    expect(comparable(underTemporal), `CHAOS_SEED=${seed}`).toEqual(
      comparable(underReplay),
    );
  }, 480_000);
});
