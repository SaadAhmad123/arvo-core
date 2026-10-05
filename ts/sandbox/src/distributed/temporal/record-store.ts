import {
  type Client,
  WithStartWorkflowOperation,
  WorkflowNotFoundError,
} from '@temporalio/client';
import { WorkflowIdConflictPolicy } from '@temporalio/common';
import type { JSONObject } from 'arvo-core';
import type { CommitOutcome, CommitRequest } from './protocol.js';
import { RECORD_QUEUE } from './queues.js';
import { commit, executionRecord, recordHeld } from './workflows.js';

/**
 * The record store, as Temporal holds it.
 *
 * One workflow per execution, named after the execution the handler
 * identified. Reading a record is a query against it; committing one is
 * an update. Nothing else stores anything: the record is that workflow's
 * state, and it stays readable for as long as the namespace retains the
 * workflow's history.
 */

/** The workflow holding one execution's record. */
const recordWorkflowId = (executionId: string): string =>
  `record-${executionId}`;

/**
 * The latest record of one execution, or `null` where there is none.
 *
 * Read on every call, and nothing is derived, filtered or judged here —
 * whether what comes back is a record, belongs to the event in hand, or
 * is still resumable is the handler's to decide
 * (`docs/adr/006-arvoeventhandler-protocol.md`).
 *
 * @param client - The cluster.
 * @param executionId - The execution the handler asked for.
 */
export const recordFrom = async (
  client: Client,
  executionId: string,
): Promise<JSONObject | null> => {
  try {
    return await client.workflow
      .getHandle(recordWorkflowId(executionId))
      .query(recordHeld);
  } catch (raised) {
    // No workflow is absence, which is what an execution that has never
    // been opened looks like.
    if (raised instanceof WorkflowNotFoundError) return null;
    throw raised;
  }
};

/**
 * Commits one record and the events produced with it, together.
 *
 * Creates the record's workflow where none exists and updates it where
 * one does, in one call — which is how committing at the first revision
 * only where no record exists is got without a read followed by a write.
 *
 * @param client - The cluster.
 * @param param - The execution, the queue its record runs on, and what
 * to commit.
 */
export const commitTo = async (
  client: Client,
  param: {
    executionId: string;
    taskQueue?: string;
    request: CommitRequest;
  },
): Promise<CommitOutcome> =>
  client.workflow.executeUpdateWithStart(commit, {
    args: [param.request],
    startWorkflowOperation: new WithStartWorkflowOperation(executionRecord, {
      workflowId: recordWorkflowId(param.executionId),
      taskQueue: param.taskQueue ?? RECORD_QUEUE,
      args: [{ executionId: param.executionId }],
      // The record already exists for every revision after the first,
      // and the update is the commit either way.
      workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
    }),
  });

/**
 * How many events one execution's record has published.
 *
 * @param client - The cluster.
 * @param executionId - The execution to ask about.
 */
export const publishedBy = async (
  client: Client,
  executionId: string,
): Promise<number | null> => {
  try {
    const { publishedCount } = await import('./workflows.js');
    return await client.workflow
      .getHandle(recordWorkflowId(executionId))
      .query(publishedCount);
  } catch (raised) {
    if (raised instanceof WorkflowNotFoundError) return null;
    throw raised;
  }
};
