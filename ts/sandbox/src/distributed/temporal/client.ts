import {
  context as activeContext,
  type Span,
  type SpanContext,
  trace as traceApi,
} from '@opentelemetry/api';
import { Client, Connection } from '@temporalio/client';
import { OpenTelemetryWorkflowClientInterceptor } from '@temporalio/interceptors-opentelemetry';
import {
  type ArvoEvent,
  ArvoEventSerializer,
  mutateArvoEvent,
  traceContextFromSpan,
} from 'arvo-core';
import { checkSource, continuing } from '../shared/entering.js';
import { destinationFor } from '../shared/routing.js';
import type { RunOutcome } from './protocol.js';
import { RUN_QUEUE } from './queues.js';
import type { arvoRun } from './workflows.js';

/**
 * How anything outside the lattice starts a run, or answers one.
 *
 * A sender from outside owes two things, and both are checked here
 * rather than discovered later: its `source` must not be any handler's
 * contract type, and it is the address the run answers to.
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
 * @param param - Where the cluster is, and which namespace to work in.
 */
export const reachTemporal = async (param: {
  temporalAddress: string;
  temporalNamespace: string;
}): Promise<TemporalReach> => {
  const connection = await Connection.connect({
    address: param.temporalAddress,
  });

  const client = new Client({
    connection,
    namespace: param.temporalNamespace,
    // without this, a run started from outside is a trace of its own
    interceptors: {
      workflow: [new OpenTelemetryWorkflowClientInterceptor()],
    },
  });

  return { client, close: () => connection.close() };
};

/**
 * Starts a run, and hands back how it ended.
 *
 * @param client - The cluster.
 * @param event - The event entering the lattice. Its `source` is where
 * the run answers, and must not be a handler's contract type.
 * @param span - What the run belongs to. Without one the run is a trace
 * of its own, which is right for something nothing else caused and
 * wrong for everything else.
 */
export const startRun = async (
  client: Client,
  event: ArvoEvent,
  span?: Span | SpanContext,
): Promise<RunOutcome> => {
  checkSource(event.source);

  const entering = continuing(event, span);
  const destination = destinationFor(entering);
  if (destination.kind !== 'handled') {
    throw new Error(
      `${event.type} ${event.id} is addressed to ${event.to}, which no handler in this lattice implements, so there is no run to start`,
    );
  }

  const starting = async (): Promise<RunOutcome> =>
    client.workflow.execute<typeof arvoRun>('arvoRun', {
      // the event's own id: unique, and the same if started again
      workflowId: `run-${entering.id}`,
      taskQueue: RUN_QUEUE,
      args: [
        {
          payload: await WIRE.serialize(entering),
          addressedTo: destination.handler.contracts.self.type,
          answersTo: entering.source,
        },
      ],
    });

  // Temporal's own client interceptor reads the active context rather
  // than taking a span, so the span has to be made active around the
  // call for the workflow to be part of this trace.
  if (span === undefined || !('spanContext' in span)) return starting();
  return activeContext.with(
    traceApi.setSpan(activeContext.active(), span),
    starting,
  );
};

/**
 * Answers an event that left the lattice, and carries on the run.
 *
 * There is no resuming. The answer is ordinary work and this is the same
 * call as starting a run, because the loop keeps nothing between turns.
 *
 * @param client - The cluster.
 * @param param - What left the lattice, the answer to it, who answered,
 * and the span to continue the trace from. Without a span the trace of
 * the request that left is continued instead, so an answer given hours
 * later still belongs to the run that asked.
 */
export const answerFromOutside = async (
  client: Client,
  param: {
    lifted: ArvoEvent;
    answer: ArvoEvent;
    span?: Span | SpanContext;
  },
): Promise<RunOutcome> => {
  const trace =
    param.span === undefined
      ? {
          traceparent: param.lifted.traceparent,
          tracestate: param.lifted.tracestate,
        }
      : traceContextFromSpan(param.span);

  return startRun(
    client,
    mutateArvoEvent(param.answer, {
      traceparent: trace.traceparent ?? undefined,
      tracestate: trace.tracestate ?? undefined,
    }),
    param.span,
  );
};
