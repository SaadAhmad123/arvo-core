import { type Meter, metrics, type Tracer, trace } from '@opentelemetry/api';
import { logs } from '@opentelemetry/api-logs';
import type { ArvoLogger } from 'arvo-core';
import { deliveryLogAttributes } from './log-context.js';

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
 * it was under.
 *
 * ## Why two of these are built by hand
 *
 * Only the tracer resolves itself. `trace.getTracer` answers through a
 * proxy provider, so a tracer taken before an SDK is registered starts
 * working when one is. `metrics.getMeter` and `logs.getLogger` do not:
 * each answers from whatever provider is registered *at the moment it is
 * called*, and a worker's SDK is registered inside a function while this
 * module is evaluated at import — which is always earlier.
 *
 * Taken at face value, that makes every handler metric and every handler
 * log line disappear into a no-op, for the whole life of the process,
 * with nothing to see. So the meter and the logger below resolve per
 * use. It is a real difference between the three APIs rather than
 * something this file chose.
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
export const loggerFor = (name: string, version?: string): ArvoLogger => ({
  emit: (record) => {
    // Resolved per line rather than once: a logger taken before an SDK
    // is registered answers from the no-op provider for ever.
    logs.getLogger(name, version).emit({
      severityNumber: record.severityNumber,
      body: record.body,
      attributes: {
        // Which delivery this line belongs to, on the line. The span
        // carries the execution's identity too, and a trace store can be
        // asked for one execution's spans — but a log store cannot join
        // to it, and "every line for this workflow" is the question an
        // operator actually asks.
        ...deliveryLogAttributes(),
        ...(record.attributes as Record<string, string | number | boolean>),
      },
    });
  },
});

/**
 * A meter that asks the global provider on every call.
 *
 * Every property is forwarded, so this is whatever a `Meter` is rather
 * than the subset something here remembered to implement — including
 * anything a later version of the API adds.
 *
 * @param name - What the instruments are attributed to.
 */
const meterResolvedPerUse = (name: string): Meter =>
  new Proxy({} as Meter, {
    get: (_unused, member: string | symbol) => {
      const current = metrics.getMeter(name) as unknown as Record<
        string | symbol,
        unknown
      >;
      const found = current[member];
      return typeof found === 'function' ? found.bind(current) : found;
    },
  });

/** What every handler in this run is declared with. */
export const HANDLER_TELEMETRY: {
  readonly tracer: Tracer;
  readonly meter: Meter;
  readonly logger: ArvoLogger;
} = {
  tracer: trace.getTracer(INSTRUMENTED),
  meter: meterResolvedPerUse(INSTRUMENTED),
  logger: loggerFor(INSTRUMENTED),
};
