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
  readonly tracer?: Tracer;
  /** What instruments are created on. */
  readonly meter?: Meter;
  /** What log records are emitted through. */
  readonly logger?: ArvoLogger;
};

/** Where a call records, its tracer settled; a meter or logger nobody gave stays absent. */
export type ArvoResolvedTelemetry = ArvoTelemetryParam & {
  readonly tracer: Tracer;
};

/**
 * The telemetry a call records with: each part as given, and a tracer from
 * whatever OpenTelemetry provider is registered now where none was given. A
 * meter or logger nobody gave stays absent.
 *
 * @param givenTelemetry - The telemetry given with the call, where any was.
 *
 * @example
 * const resolvedTelemetry = resolveTelemetry({ logger });
 * resolvedTelemetry.tracer; // always present
 */
export const resolveTelemetry = (
  givenTelemetry: ArvoTelemetryParam | undefined,
): ArvoResolvedTelemetry =>
  Object.freeze({
    tracer:
      givenTelemetry?.tracer ??
      trace.getTracer(ARVO_INSTRUMENTATION_NAME, ARVO_RECORD_FORMAT_VERSION),
    // a null from untyped code is left out like an omission, never kept as a part
    ...(givenTelemetry?.meter ? { meter: givenTelemetry.meter } : {}),
    ...(givenTelemetry?.logger ? { logger: givenTelemetry.logger } : {}),
  });
