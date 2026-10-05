import { type Meter, metrics, type Tracer, trace } from '@opentelemetry/api';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-grpc';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-grpc';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import type { Resource } from '@opentelemetry/resources';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';
import {
  BatchSpanProcessor,
  type SpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';
import type { ArvoLogger } from 'arvo-core';
import { loggerFor } from '../handler/telemetry.js';
import type { DistributedConfig } from './config.js';

/**
 * Every signal this process produces, on its way to one endpoint.
 *
 * Built once per process and handed down. A worker knows nothing about
 * where a signal ends up — only that there is a collector — which is
 * what lets a backend change without a line of this changing.
 *
 * ADR-006 puts the OpenTelemetry API inside the model, so the three
 * objects a handler is given here are the real ones. Nothing is a
 * no-op: a signal that is missing is missing because nothing produced
 * it.
 */

/** What a worker records against, and how to stop recording cleanly. */
export type Telemetry = {
  /** What each execution's span is started on. */
  readonly tracer: Tracer;
  /** What this handler's instruments are created on. */
  readonly meter: Meter;
  /** What log records are emitted through. */
  readonly logger: ArvoLogger;
  /**
   * What names this process on every signal it produces.
   *
   * Exposed because a framework with tracing of its own has to be given
   * the same one. Two resources would make one run two services, and
   * nothing would join them.
   */
  readonly resource: Resource;
  /**
   * Where spans go.
   *
   * Exposed for the same reason as the resource, and it must be this
   * instance rather than an equivalent one: a framework exporting
   * through a processor of its own would flush on its own schedule, and
   * a trace half-exported is a trace nobody can read.
   */
  readonly spanProcessor: SpanProcessor;
  /**
   * Flushes everything buffered and stops.
   *
   * Called on the way out, before the process exits: a span that was
   * never exported is a span that may as well not have been recorded,
   * and the last thing a worker does is usually the interesting part.
   */
  readonly shutdown: () => Promise<void>;
};

/**
 * Starts this process's telemetry.
 *
 * @param config - Where to send it, and what to call this process.
 * @returns What to record against, and how to stop.
 */
export const startTelemetry = (config: DistributedConfig): Telemetry => {
  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: config.serviceName,
    [ATTR_SERVICE_VERSION]: config.serviceVersion,
  });

  // One processor, shared with whatever framework is carrying the work,
  // so both views of one run arrive through the same pipeline.
  const spanProcessor = new BatchSpanProcessor(
    new OTLPTraceExporter({ url: config.otlpEndpoint }),
  );

  const sdk = new NodeSDK({
    resource,
    spanProcessors: [spanProcessor],
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({ url: config.otlpEndpoint }),
      // short, so a test that has just finished a run can read a counter
      // rather than waiting for an interval tuned for production
      exportIntervalMillis: 1_000,
    }),
    logRecordProcessors: [
      new BatchLogRecordProcessor({
        exporter: new OTLPLogExporter({ url: config.otlpEndpoint }),
        // short, for the same reason the metric interval is
        scheduledDelayMillis: 500,
      }),
    ],
    // the store's own queries appear beneath the span that caused them,
    // which is how a slow execution is told from a slow database
    instrumentations: [new PgInstrumentation()],
  });

  sdk.start();

  return {
    tracer: trace.getTracer(config.serviceName, config.serviceVersion),
    meter: metrics.getMeter(config.serviceName, config.serviceVersion),
    logger: loggerFor(config.serviceName, config.serviceVersion),
    resource,
    spanProcessor,
    shutdown: () => sdk.shutdown(),
  };
};
