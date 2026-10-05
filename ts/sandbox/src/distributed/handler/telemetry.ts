import { type Meter, metrics, type Tracer, trace } from '@opentelemetry/api';
import { logs } from '@opentelemetry/api-logs';
import type { ArvoLogger } from 'arvo-core';

/**
 * What the handlers record against, which is nobody's in particular.
 *
 * ADR-006 puts the OpenTelemetry API inside the model, so a handler must
 * be observable without whatever runs it writing any instrumentation.
 * That is only true if a handler can reach telemetry without being
 * handed it by a mechanism — so these come from the OpenTelemetry
 * globals, which whichever worker started the SDK has already
 * registered.
 *
 * Reached rather than given, deliberately. A handler that took its
 * tracer from a mechanism would be a handler that knew which mechanism
 * it was under, and every one of these is a proxy that resolves when it
 * is first used, so nothing here depends on being imported after a
 * worker has started.
 *
 * Nothing is a no-op: a signal that is missing is missing because
 * nothing produced it.
 */

/** What the handlers call themselves on every span, metric and log. */
const INSTRUMENTED = 'arvo-handler';

/**
 * The package's own logger shape, over the OpenTelemetry logs API.
 *
 * `arvo-core` takes a logger structurally rather than importing one, so
 * that it depends on no logging API. This is the one adapter that costs.
 *
 * @param name - What the logger records as having emitted the line.
 * @param version - Which build of it, so two can be told apart.
 */
export const loggerFor = (name: string, version?: string): ArvoLogger => {
  const emitting = logs.getLogger(name, version);
  return {
    emit: (record) => {
      emitting.emit({
        severityNumber: record.severityNumber,
        body: record.body,
        attributes: record.attributes as Record<
          string,
          string | number | boolean
        >,
      });
    },
  };
};

/** What every handler in this run is declared with. */
export const HANDLER_TELEMETRY: {
  readonly tracer: Tracer;
  readonly meter: Meter;
  readonly logger: ArvoLogger;
} = {
  tracer: trace.getTracer(INSTRUMENTED),
  meter: metrics.getMeter(INSTRUMENTED),
  logger: loggerFor(INSTRUMENTED),
};
