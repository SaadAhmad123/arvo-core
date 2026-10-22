import { metrics, trace } from '@opentelemetry/api';
import { describe, expect, it } from 'vitest';
import { telemetryForHandler } from '../../../src/ArvoDispatcher/helpers/telemetry-for-handler.js';
import { resolveTelemetry } from '../../../src/ArvoEventHandler/context/telemetry/resolve.js';

describe('the telemetry a dispatcher enters a handler with', () => {
  const tracer = trace.getTracer('given');

  it('holds the tracer alone where nothing else was resolved', () => {
    expect(telemetryForHandler(resolveTelemetry({ tracer }))).toStrictEqual({
      tracer,
    });
  });

  it('holds every part that was resolved, each the same object', () => {
    const meter = metrics.getMeter('given');
    const logger = { emit: () => undefined };
    expect(
      telemetryForHandler(resolveTelemetry({ tracer, meter, logger })),
    ).toStrictEqual({ tracer, meter, logger });
  });

  it('resolves back to exactly what the dispatcher resolved', () => {
    const resolvedTelemetry = resolveTelemetry({ tracer });
    expect(resolveTelemetry(telemetryForHandler(resolvedTelemetry))).toEqual(
      resolvedTelemetry,
    );
  });
});
