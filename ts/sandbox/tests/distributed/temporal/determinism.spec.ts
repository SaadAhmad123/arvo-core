import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { historyFromJSON } from '@temporalio/common/lib/proto-utils.js';
import { Worker } from '@temporalio/worker';
import { createArvoEventFactory } from 'arvo-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { orderFulfilContract } from '../../../src/distributed/handler/com_order_fulfil/contract.js';
import { startRun } from '../../../src/distributed/temporal/client.js';
import { startTemporalHarness, type TemporalHarness } from './harness.js';

/**
 * Sections 12.5 and 13.5: the adapter's workflow code, judged by
 * Temporal's own replay checker.
 *
 * A replay here is not a second run. Every activity result comes out of
 * the history rather than from a handler, so nothing of the lattice runs
 * at all — what is being judged is whether the loop, given the same
 * answers in the same order, makes the same commands. A failure means
 * the adapter is non-conformant as Temporal defines it, and that any
 * execution in flight across a deploy of it would break.
 *
 * Two things are therefore checked, and they are different questions.
 * A history captured from the cluster now proves the code agrees with
 * itself. A history committed to the repository proves the code still
 * agrees with the code that wrote it — which is the check that has to
 * fail *before* a change ships, and the only one of the two that can.
 *
 * Needs the cluster up and migrated.
 */

/** Where the workflow code is, exactly as the workers load it. */
const WORKFLOWS = new URL(
  '../../../src/distributed/temporal/workflows.ts',
  import.meta.url,
).pathname;

/**
 * The interceptors the workers load, which are part of the workflow
 * code: a replay without them is a replay of something else.
 */
const WORKFLOW_MODULES = [
  createRequire(import.meta.url).resolve(
    '@temporalio/interceptors-opentelemetry/lib/workflow-interceptors',
  ),
];

/** A history kept in the repository, so a change can be judged against it. */
const RECORDED = new URL(
  '../../fixtures/temporal/arvo-run-history.json',
  import.meta.url,
).pathname;

/** Something no handler is named by, which is where a run answers. */
const CALLER = 'com.test.determinism';

describe("the adapter's workflow code", () => {
  let harness: TemporalHarness;

  beforeAll(async () => {
    harness = await startTemporalHarness('arvo-temporal-determinism-spec');
  }, 120_000);

  afterAll(async () => {
    await harness?.stop();
  }, 60_000);

  /** One real run on the cluster, and the history it wrote. */
  const aRunAndItsHistory = async (orderRef: string) => {
    const opening = createArvoEventFactory(
      orderFulfilContract.versions['1.0.0'],
    ).createInput({
      source: CALLER,
      subject: orderRef,
      to: orderFulfilContract.type,
      data: { orderRef, category: 'orders', width: 2, depth: 1 },
    });

    const outcome = await startRun(harness.client, opening);
    const history = await harness.client.workflow
      .getHandle(`run-${opening.id}`)
      .fetchHistory();

    return { outcome, history };
  };

  it('replays a history it wrote on the cluster, by Temporal’s own checker', async () => {
    const { outcome, history } = await aRunAndItsHistory(
      `determinism-${Date.now()}`,
    );
    // a run that did something, so the history has commands in it to
    // disagree about
    expect(outcome.deliveries).toBeGreaterThan(2);

    // Throws on a determinism violation and returns otherwise. Nothing
    // of the lattice runs: the activity results come from the history.
    await expect(
      Worker.runReplayHistory(
        {
          workflowsPath: WORKFLOWS,
          interceptors: { workflowModules: WORKFLOW_MODULES },
        },
        history,
      ),
    ).resolves.toBeUndefined();
  }, 240_000);

  it('replays the history committed to this repository, so a change that would break one fails here', async () => {
    const recorded = await readFile(RECORDED, 'utf8').catch(() => null);
    if (recorded === null) {
      throw new Error(
        `no recorded history at ${RECORDED}. Write one with \`pnpm distributed:temporal:record-history\`, and commit it: without it this check can only compare the code to itself.`,
      );
    }

    await expect(
      Worker.runReplayHistory(
        {
          workflowsPath: WORKFLOWS,
          interceptors: { workflowModules: WORKFLOW_MODULES },
        },
        historyFromJSON(JSON.parse(recorded)),
      ),
    ).resolves.toBeUndefined();
  }, 240_000);

  it('fails a history whose workflow made commands this code would not', async () => {
    // The check is worth having only if it can fail. A history with its
    // commands taken out is one no version of this code could have
    // written, so the checker must refuse it — and if it does not, a
    // passing replay above says nothing.
    const { history } = await aRunAndItsHistory(
      `determinism-torn-${Date.now()}`,
    );

    const torn = {
      ...history,
      events: history.events?.filter(
        (one) => one.activityTaskScheduledEventAttributes === undefined,
      ),
    };

    await expect(
      Worker.runReplayHistory(
        {
          workflowsPath: WORKFLOWS,
          interceptors: { workflowModules: WORKFLOW_MODULES },
        },
        torn,
      ),
    ).rejects.toThrow();
  }, 240_000);
});
