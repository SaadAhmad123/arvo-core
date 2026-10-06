import {
  type Client,
  WithStartWorkflowOperation,
  WorkflowIdConflictPolicy,
  WorkflowNotFoundError,
} from '@temporalio/client';
import type { JSONObject } from 'arvo-core';
import type { CommitOutcome, Revision } from './protocol.js';
import { RECORD_QUEUE } from './queues.js';
import { commitRevision, executionRecord, stateHeld } from './workflows.js';

/**
 * The record store, as Temporal holds it.
 *
 * One workflow per execution, named after the execution the handler
 * identified. Reading a record is a query against it; committing a
 * revision is an update. Nothing else stores anything.
 *
 * A record is readable for as long as the namespace retains that
 * workflow's history, which is the store's retention here.
 */

/** The workflow holding one execution's revisions. */
const recordWorkflowId = (executionId: string): string =>
  `record-${executionId}`;

/**
 * The latest record of one execution, or `null` where there is none.
 *
 * Read on every call. Nothing is derived, filtered or judged: whether
 * what comes back is a record, belongs to the event in hand, or is still
 * resumable is the handler's to decide
 * (`docs/adr/006-arvoeventhandler-protocol.md`).
 *
 * @param client - The cluster.
 * @param executionId - The execution the handler asked for.
 */
export const stateOf = async (
  client: Client,
  executionId: string,
): Promise<JSONObject | null> => {
  try {
    return await client.workflow
      .getHandle(recordWorkflowId(executionId))
      .query(stateHeld);
  } catch (raised) {
    // No workflow is absence: an execution nothing has opened.
    if (raised instanceof WorkflowNotFoundError) return null;
    throw raised;
  }
};

/**
 * Commits one revision — a record and the events produced with it.
 *
 * Creates the execution's workflow where none exists and updates it
 * where one does, in one call, which is how committing the first
 * revision only where no record exists is had without a read followed
 * by a write.
 *
 * @param client - The cluster.
 * @param param - The execution, and the revision to commit.
 */
export const commitTo = async (
  client: Client,
  param: { executionId: string; revision: Revision },
): Promise<CommitOutcome> =>
  client.workflow.executeUpdateWithStart(commitRevision, {
    args: [param.revision],
    startWorkflowOperation: new WithStartWorkflowOperation(executionRecord, {
      workflowId: recordWorkflowId(param.executionId),
      taskQueue: RECORD_QUEUE,
      args: [{ executionId: param.executionId }],
      // The record exists for every revision after the first, and the
      // update is the commit either way.
      workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
    }),
  });
