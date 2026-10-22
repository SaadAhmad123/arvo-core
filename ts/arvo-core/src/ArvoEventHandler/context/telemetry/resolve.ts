import { type Meter, type Tracer, trace } from '@opentelemetry/api';
import { ARVO_RECORD_FORMAT_VERSION } from '../../helpers/defaults.js';
import { ARVO_INSTRUMENTATION_NAME } from './prefix.js';
import type { ArvoLogger } from './types.js';

/**
 * Where a party records: the tracer its spans are started on, the meter its
 * instruments are created on, and what its log records are emitted through.
 *
 * Each is optional and each is a no-op where it is absent, so a deployment
 * with no OpenTelemetry SDK configured costs nothing and changes no code.
 */
export type ArvoTelemetryParam = {
  /** What each span is started on. */
  tracer?: Tracer;
  /** What instruments are created on. */
  meter?: Meter | null;
  /** What log records are emitted through. */
  logger?: ArvoLogger | null;
};

/** Where a party records, every part resolved. */
export type ArvoResolvedTelemetry = {
  readonly tracer: Tracer;
  readonly meter: Meter | null;
  readonly logger: ArvoLogger | null;
};

/**
 * Each part as given, or its default: a tracer from the global provider under
 * the package's one instrumentation name, no meter and no logger.
 *
 * @param given - The telemetry a party was declared with, where it was.
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
