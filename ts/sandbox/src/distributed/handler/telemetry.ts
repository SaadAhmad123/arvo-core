import { type Meter, metrics, trace } from '@opentelemetry/api';
import { logs } from '@opentelemetry/api-logs';
import type { ArvoLogger, ArvoTelemetryParam } from 'arvo-core';
import { deliveryLogAttributes } from './log-context.js';

/**
 * What every delivery in this run records with.
 *
 * Given to the dispatcher with each delivery, which hands the same to the
 * handler it enters: where a handler records is decided by whatever runs
 * it, never by the handler. Each mechanism asks for it once per delivery.
 *
 * ## Why each part is taken late
 *
 * The OpenTelemetry API answers from whatever provider is registered at
 * the moment it is asked, and a worker registers its SDK inside a function
 * while this module is evaluated at import — always earlier. Since the API
 * loads as two copies, one for `import` and one for `require`, even a
 * tracer taken early through `import` can stay silent for good: the SDK
 * registers through the other copy.
 *
 * So nothing is taken at import. The tracer is taken when a delivery
 * begins, and the meter and the logger resolve on every use, so a metric
 * or a line recorded mid-delivery reaches whatever is registered then.
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

/**
 * Where one delivery records, taken when it begins: a tracer from whatever
 * provider is registered now, and a meter and logger that resolve on every
 * use.
 */
export const deliveryTelemetry = (): ArvoTelemetryParam => ({
  tracer: trace.getTracer(INSTRUMENTED),
  meter: meterResolvedPerUse(INSTRUMENTED),
  logger: loggerFor(INSTRUMENTED),
});
