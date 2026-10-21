import type { Client } from '@temporalio/client';
import type { ArvoEvent } from 'arvo-core';
import { startRun as startDbosRun } from '../../../src/distributed/dbos/client.js';
import type { Workflows } from '../../../src/distributed/dbos/workflows.js';
import type { DeliveryScope } from '../../../src/distributed/replay/delivery.js';
import { runOneWorkflow } from '../../../src/distributed/replay/loop.js';
import type { RecordStore } from '../../../src/distributed/shared/record-store.js';
import { startRun as startTemporalRun } from '../../../src/distributed/temporal/client.js';
import type { RunOutcome as TemporalRunOutcome } from '../../../src/distributed/temporal/protocol.js';
import { stateOf } from '../../../src/distributed/temporal/record-store.js';
import { openingExecutionOf, type WorkflowEnding } from './chaos.js';

/**
 * One chaos workflow run to its end under each mechanism, and read back
 * the same way: how the run ended, what the caller was published, and
 * where the opening execution's record rests.
 *
 * A run that raises is an ending too, reported by its kind rather than
 * thrown, so one broken workflow cannot hide what the others did.
 */

/** A run that raised, as an ending kind. */
const raisedAs = (raised: unknown) => ({
  kind: `raised: ${String(raised)}`,
  events: [] as readonly string[],
});

/** What a Temporal run published to the caller, in the event's own format. */
export const publishedByTemporal = (
  outcome: TemporalRunOutcome,
): readonly string[] => outcome.events.map((one) => one.payload);

/** Under the plain loop. */
export const endingUnderReplay = async (
  scope: DeliveryScope,
  event: ArvoEvent,
): Promise<WorkflowEnding> => {
  const outcome = await runOneWorkflow(scope, event).catch(raisedAs);
  return {
    runKind: outcome.kind,
    published: outcome.events,
    record: await scope.store.readRecord(await openingExecutionOf(event)),
  };
};

/** Under DBOS. */
export const endingUnderDbos = async (
  dbos: { readonly workflows: Workflows; readonly store: RecordStore },
  event: ArvoEvent,
): Promise<WorkflowEnding> => {
  const outcome = await startDbosRun(dbos.workflows, event).catch(raisedAs);
  return {
    runKind: outcome.kind,
    published: outcome.events,
    record: await dbos.store.readRecord(await openingExecutionOf(event)),
  };
};

/**
 * Under Temporal.
 *
 * @param client - The cluster.
 * @param event - The event opening the workflow.
 * @param waitFor - How the run's outcome is waited on; starting it here
 * where omitted, or reading one already started, as after a restart.
 */
export const endingUnderTemporal = async (
  client: Client,
  event: ArvoEvent,
  waitFor: () => Promise<TemporalRunOutcome> = () =>
    startTemporalRun(client, event),
): Promise<WorkflowEnding> => {
  const ending = await waitFor().then(
    (outcome) => ({
      runKind: outcome.kind,
      published: publishedByTemporal(outcome),
    }),
    (raised: unknown) => ({
      runKind: raisedAs(raised).kind,
      published: [] as readonly string[],
    }),
  );
  return {
    ...ending,
    record: await stateOf(client, await openingExecutionOf(event)),
  };
};
