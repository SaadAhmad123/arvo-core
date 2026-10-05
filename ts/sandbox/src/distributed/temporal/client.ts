import { Client, Connection } from '@temporalio/client';
import { OpenTelemetryWorkflowClientInterceptor } from '@temporalio/interceptors-opentelemetry';
import { type ArvoEvent, ArvoEventSerializer } from 'arvo-core';
import type { DistributedConfig } from '../shared/config.js';
import { destinationFor } from '../shared/routing.js';
import { queueFor } from './queues.js';
import type { deliverEvent } from './workflows.js';

/**
 * How anything outside a worker puts an event into a run.
 *
 * Whoever starts a run, whoever answers a request that left the lattice,
 * and the publisher recovering a committed event all do the same thing
 * through here.
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
    // without this, a run started from outside is a trace of its own
    interceptors: {
      workflow: [new OpenTelemetryWorkflowClientInterceptor()],
    },
  });

  return { client, close: () => connection.close() };
};

/** What happened when one event was handed to the cluster. */
export type Handed =
  /** A delivery was started for it. */
  | { readonly kind: 'delivering'; readonly workflowId: string }
  /** It was already being delivered, which is the outcome asked for. */
  | { readonly kind: 'already_delivering'; readonly workflowId: string }
  /** Nothing running will carry it, for the event's own reason. */
  | { readonly kind: 'not_ours'; readonly because: string };

/** Whether a failure is Temporal saying that workflow is already there. */
const isAlreadyStarted = (raised: unknown): boolean =>
  raised instanceof Error &&
  raised.name === 'WorkflowExecutionAlreadyStartedError';

/**
 * Hands one event to the cluster.
 *
 * @param client - The cluster.
 * @param event - The event, as it was committed.
 */
export const handToCluster = async (
  client: Client,
  event: ArvoEvent,
): Promise<Handed> => {
  const destination = destinationFor(event);

  if (destination.kind === 'left') {
    return {
      kind: 'not_ours',
      because: `it carries the domain ${destination.domain}`,
    };
  }
  if (destination.kind === 'outside') {
    return {
      kind: 'not_ours',
      because: `nothing here implements ${destination.addressedTo}`,
    };
  }

  const addressedTo = destination.handler.contracts.self.type;

  try {
    await client.workflow.start<typeof deliverEvent>('deliverEvent', {
      workflowId: event.id,
      taskQueue: queueFor(addressedTo),
      args: [{ payload: await WIRE.serialize(event), addressedTo }],
    });
    return { kind: 'delivering', workflowId: event.id };
  } catch (raised) {
    if (isAlreadyStarted(raised)) {
      return { kind: 'already_delivering', workflowId: event.id };
    }
    throw raised;
  }
};
