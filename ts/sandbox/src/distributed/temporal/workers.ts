import { createRequire } from 'node:module';
import {
  OpenTelemetryActivityInboundInterceptor,
  OpenTelemetryActivityOutboundInterceptor,
} from '@temporalio/interceptors-opentelemetry';
import { type NativeConnection, Worker } from '@temporalio/worker';
import type { Pool } from 'pg';
import type { DistributedConfig } from '../shared/config.js';
import { storeFor } from '../shared/store.js';
import type { Telemetry } from '../shared/telemetry.js';
import { createActivities } from './activities.js';
import { LEAF_QUEUE, ORCHESTRATION_QUEUE } from './queues.js';
import { workflowSpanSink } from './workflow-spans.js';

/**
 * The workers themselves, apart from the process that usually runs them.
 *
 * Separate so that a conformance suite runs the same workers a
 * deployment would rather than something assembled to be convenient. A
 * suite that tested a different worker would be testing nothing.
 *
 * One worker per queue. The queues exist so that a five-hundred-wide
 * fan-out of leaves cannot take every slot and leave the execution
 * waiting for them unable to get one — which it cannot, because each
 * worker has its own slots.
 */

/** How many workflow tasks one worker will carry at once. */
const WORKFLOW_SLOTS = 40;

/** Where the workflow code is, found from this file rather than from a cwd. */
const WORKFLOWS = new URL('workflows.ts', import.meta.url).pathname;

/**
 * Creates one worker per queue, against one connection and one pool.
 *
 * @param param - The cluster to connect to, what to record against, and
 * the pool every execution reaches the store through.
 */
export const createWorkers = async (param: {
  config: DistributedConfig;
  telemetry: Telemetry;
  connection: NativeConnection;
  pool: Pool;
}): Promise<readonly Worker[]> => {
  const activities = createActivities({
    pool: param.pool,
    store: storeFor(param.pool),
  });

  // Temporal's own view of a run and Arvo's become one trace here.
  // Context is carried into the workflow by an interceptor module that
  // runs inside the isolate, and into the activity by an interceptor
  // that runs out here; Arvo then continues the event's own traceparent
  // beneath both. Without all three the two views never meet, and a
  // workflow whose spans and Arvo's spans do not join is a workflow
  // nobody can debug.
  const resolve = createRequire(import.meta.url).resolve;
  const workflowInterceptors = [
    resolve('@temporalio/interceptors-opentelemetry/lib/workflow'),
  ];

  return Promise.all(
    [ORCHESTRATION_QUEUE, LEAF_QUEUE].map((taskQueue) =>
      Worker.create({
        connection: param.connection,
        namespace: param.config.temporalNamespace,
        taskQueue,
        workflowsPath: WORKFLOWS,
        activities,
        interceptors: {
          activity: [
            (ctx) => ({
              inbound: new OpenTelemetryActivityInboundInterceptor(ctx, {
                tracer: param.telemetry.tracer,
              }),
              outbound: new OpenTelemetryActivityOutboundInterceptor(ctx),
            }),
          ],
          workflowModules: workflowInterceptors,
        },
        // Where the spans workflow code makes come out. They are made
        // inside an isolate that can reach nothing, so this is the only
        // way they leave at all.
        sinks: {
          exporter: workflowSpanSink(
            param.telemetry.spanProcessor,
            param.telemetry.resource,
          ),
        },
        // Bounded on purpose. A run that arrives faster than this slows
        // down, which is what back-pressure is; one that is unbounded
        // falls over instead.
        maxConcurrentActivityTaskExecutions: param.config.concurrency,
        maxConcurrentWorkflowTaskExecutions: WORKFLOW_SLOTS,
      }),
    ),
  );
};
