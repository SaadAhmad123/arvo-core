import { metrics, trace } from '@opentelemetry/api';
import { describe, expect, it } from 'vitest';
import {
  type ArvoTelemetryParam,
  resolveTelemetry,
} from '../../../../src/ArvoEventHandler/context/telemetry/resolve.js';

describe('resolving where a call records', () => {
  it('takes each part it is given', () => {
    const tracer = trace.getTracer('given');
    const meter = metrics.getMeter('given');
    const logger = { emit: () => undefined };
    expect(resolveTelemetry({ tracer, meter, logger })).toStrictEqual({
      tracer,
      meter,
      logger,
    });
  });

  it('records through the global tracer, with no meter or logger, where nothing is given', () => {
    const resolvedTelemetry = resolveTelemetry(undefined);
    expect(resolvedTelemetry.tracer).toBeDefined();
    expect(resolvedTelemetry).not.toHaveProperty('meter');
    expect(resolvedTelemetry).not.toHaveProperty('logger');
  });

  it('fills in only the tracer, leaving a meter or logger nobody gave absent', () => {
    const logger = { emit: () => undefined };
    const resolvedTelemetry = resolveTelemetry({ logger });
    expect(resolvedTelemetry.logger).toBe(logger);
    expect(resolvedTelemetry).not.toHaveProperty('meter');
  });

  it('takes a meter or logger given as null, as untyped code could, as absent', () => {
    const resolvedTelemetry = resolveTelemetry({
      // @ts-expect-error deliberately invalid: null from code no type checker saw
      meter: null,
      // @ts-expect-error deliberately invalid: null from code no type checker saw
      logger: null,
    });
    expect(resolvedTelemetry).not.toHaveProperty('meter');
    expect(resolvedTelemetry).not.toHaveProperty('logger');
  });

  it('is itself telemetry a call can be given, unchanged', () => {
    const resolvedTelemetry = resolveTelemetry(undefined);
    const givenAgain: ArvoTelemetryParam = resolvedTelemetry;
    expect(resolveTelemetry(givenAgain)).toStrictEqual(resolvedTelemetry);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(resolveTelemetry(undefined))).toBe(true);
  });
});

describe('telemetry given with a call', () => {
  it('is read-only to whatever holds it as given', () => {
    const telemetry: ArvoTelemetryParam = { tracer: trace.getTracer('given') };
    const reassign = () => {
      // @ts-expect-error what a call is given is only read
      telemetry.tracer = trace.getTracer('another');
    };
    expect(reassign).toBeTypeOf('function');
  });
});
