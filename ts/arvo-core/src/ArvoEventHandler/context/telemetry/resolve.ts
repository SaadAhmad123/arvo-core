import { type Meter, type Tracer, trace } from '@opentelemetry/api';
import { ARVO_RECORD_FORMAT_VERSION } from '../../helpers/defaults.js';
import { ARVO_INSTRUMENTATION_NAME } from './prefix.js';
import type { ArvoLogger } from './types.js';

/**
 * Where a call records: the tracer its spans are started on, the meter its
 * instruments are created on, and what its log records are emitted through.
 *
 * Given with each call and used for that call alone. Each part is optional:
 * a tracer omitted is taken from whatever OpenTelemetry provider is
 * registered when the call begins, and a meter or logger omitted records
 * nothing. With no SDK configured, every part costs nothing.
 *
 * @example
 * ```typescript
 * const telemetry: ArvoTelemetryParam = { tracer, logger };
 * await handler.execute({ event, state, attempt: 0, telemetry });
 * ```
 */
export type ArvoTelemetryParam = {
  /** What each span is started on. */
  tracer?: Tracer;
  /** What instruments are created on. */
  meter?: Meter;
  /** What log records are emitted through. */
  logger?: ArvoLogger;
};

/** Where a call records, every part resolved. */
export type ArvoResolvedTelemetry = {
  readonly tracer: Tracer;
  readonly meter: Meter | null;
  readonly logger: ArvoLogger | null;
};

/**
 * Each part as given, or its default: a tracer from the global provider under
 * the package's one instrumentation name, no meter and no logger.
 *
 * @param given - The telemetry given with the call, where any was.
 *
 * @example
 * const telemetry = resolveTelemetry({ logger });
 * telemetry.meter; // null
 */
export const resolveTelemetry = (
  given: ArvoTelemetryParam | undefined,
): ArvoResolvedTelemetry =>
  Object.freeze({
    tracer:
      given?.tracer ??
      trace.getTracer(ARVO_INSTRUMENTATION_NAME, ARVO_RECORD_FORMAT_VERSION),
    meter: given?.meter ?? null,
    logger: given?.logger ?? null,
  });
