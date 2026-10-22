import type {
  ArvoResolvedTelemetry,
  ArvoTelemetryParam,
} from '../../ArvoEventHandler/context/telemetry/resolve.js';

/**
 * The telemetry a dispatcher enters a handler with: the parts it resolved,
 * those resolved to none left out, so the handler resolves them to none
 * again and takes no default of its own for the tracer.
 *
 * @param resolvedTelemetry - What the dispatcher resolved for this call.
 */
export const telemetryForHandler = (
  resolvedTelemetry: ArvoResolvedTelemetry,
): ArvoTelemetryParam => ({
  tracer: resolvedTelemetry.tracer,
  ...(resolvedTelemetry.meter === null
    ? {}
    : { meter: resolvedTelemetry.meter }),
  ...(resolvedTelemetry.logger === null
    ? {}
    : { logger: resolvedTelemetry.logger }),
});
