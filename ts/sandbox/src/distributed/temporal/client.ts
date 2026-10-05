import { Client, Connection, type WorkflowHandle } from '@temporalio/client';
import { OpenTelemetryWorkflowClientInterceptor } from '@temporalio/interceptors-opentelemetry';
import { type ArvoEvent, ArvoEventSerializer } from 'arvo-core';
import type { DistributedConfig } from '../shared/config.js';
import { destinationFor } from '../shared/routing.js';
import { queueFor } from './queues.js';
import {
  answer,
  type arvoExecution,
  type ExecutionSummary,
} from './workflows.js';

/**
 * How anything outside a worker reaches a run.
 *
 * Three things use this: whoever starts a run, whoever answers a request
 * that left the lattice, and the publisher that recovers an event
 * committed but never sent. All three are doing the same thing — putting
 * an event where the execution it concerns will see it — and all three
 * decide where that is the same way, from the event alone.
 *
 * Nothing here knows what an event means. Routing says whether it opens
 * an execution or answers one, and this does the corresponding thing in
 * Temporal.
 */

/** The format an event crosses the boundary in. */
const WIRE = new ArvoEventSerializer({ type: 'arvoevent' });

/** A client, and how to let go of it. */
export type TemporalReach = {
  readonly client: Client;
  readonly close: () => Promise<void>;
};

/**
 * Connects to the cluster.
 *
 * The OpenTelemetry interceptor is what makes a run started from outside
 * part of the same trace as everything it causes: without it the caller's
 * span and the work's spans are two traces that happen to be about the
 * same thing.
 *
 * @param config - Where the cluster is, and which namespace to work in.
 */
export const reachTemporal = async (
  config: DistributedConfig,
): Promise<TemporalReach> => {
  const connection = await Connection.connect({
    address: config.temporalAddress,
  });

  const client = new Client({
    connection,
    namespace: config.temporalNamespace,
    interceptors: {
      workflow: [new OpenTelemetryWorkflowClientInterceptor()],
    },
  });

  return { client, close: () => connection.close() };
};

/** What happened when one event was handed to the cluster. */
export type Handed =
  /** An execution was opened for it. */
  | { readonly kind: 'opened'; readonly executionId: string }
  /** The execution it opens was already open, which is the outcome asked for. */
  | { readonly kind: 'already_open'; readonly executionId: string }
  /** It was handed to an execution already under way. */
  | { readonly kind: 'answered'; readonly executionId: string }
  /** Nothing running will carry it, and the reason is the event's own. */
  | { readonly kind: 'not_ours'; readonly because: string };

/** Whether a failure is Temporal saying the workflow is already there. */
const alreadyStarted = (raised: unknown): boolean =>
  raised instanceof Error &&
  raised.name === 'WorkflowExecutionAlreadyStartedError';

/**
 * Hands one event to the cluster, wherever it belongs.
 *
 * @param client - The cluster.
 * @param event - The event, as it was committed.
 */
export const hand = async (
  client: Client,
  event: ArvoEvent,
): Promise<Handed> => {
  const where = await destinationFor(event);

  if (where.kind === 'left') {
    return {
      kind: 'not_ours',
      because: `it carries the domain ${where.domain}`,
    };
  }

  if (where.kind === 'outside') {
    return {
      kind: 'not_ours',
      because: `nothing here implements ${where.addressedTo}`,
    };
  }

  const payload = await WIRE.serialize(event);

  if (where.kind === 'opens') {
    try {
      await client.workflow.start<typeof arvoExecution>('arvoExecution', {
        workflowId: where.executionId,
        taskQueue: queueFor(where.handler.contracts.self.type),
        args: [
          {
            triggering: payload,
            contractType: where.handler.contracts.self.type,
          },
        ],
      });
      return { kind: 'opened', executionId: where.executionId };
    } catch (raised) {
      // The execution already exists, which is what a redelivered
      // opening event looks like. Already open is what was asked for.
      if (alreadyStarted(raised)) {
        return { kind: 'already_open', executionId: where.executionId };
      }
      throw raised;
    }
  }

  await client.workflow.getHandle(where.executionId).signal(answer, payload);
  return { kind: 'answered', executionId: where.executionId };
};

/**
 * What one execution's workflow answered with, once it has.
 *
 * @param client - The cluster.
 * @param executionId - The execution to wait on.
 */
export const outcomeOf = async (
  client: Client,
  executionId: string,
): Promise<ExecutionSummary> => {
  const handle: WorkflowHandle<typeof arvoExecution> =
    client.workflow.getHandle(executionId);
  return handle.result();
};
