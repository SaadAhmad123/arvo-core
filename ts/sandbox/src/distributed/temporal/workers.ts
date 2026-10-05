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
import { QUEUES } from './queues.js';
import { workflowSpanSink } from './workflow-spans.js';

/**
 * The workers, apart from the process that usually runs them.
 *
 * Separate so a conformance suite runs the workers a deployment runs
 * rather than something assembled to be convenient.
 *
 * One worker per queue, each with its own slots.
 */

/** How many workflow tasks one worker carries at once. */
const WORKFLOW_SLOTS = 40;

/** Where the workflow code is, found from this file rather than a cwd. */
const WORKFLOWS = new URL('workflows.ts', import.meta.url).pathname;

/**
 * Creates one worker per queue, against one connection and one pool.
 *
 * @param param - The cluster, what to record against, and the pool every
 * delivery reaches the store through.
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

  // Context reaches workflow code through a module that runs inside the
  // isolate and activities through one that runs out here; without both,
  // Temporal's spans and Arvo's are two traces about the same work.
  const workflowInterceptors = [
    createRequire(import.meta.url).resolve(
      '@temporalio/interceptors-opentelemetry/lib/workflow',
    ),
  ];

  return Promise.all(
    QUEUES.map((taskQueue) =>
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
        sinks: {
          exporter: workflowSpanSink(
            param.telemetry.spanProcessor,
            param.telemetry.resource,
          ),
        },
        // Bounded, so a run that arrives faster than this slows down
        // rather than falling over.
        maxConcurrentActivityTaskExecutions: param.config.concurrency,
        maxConcurrentWorkflowTaskExecutions: WORKFLOW_SLOTS,
      }),
    ),
  );
};
