import { metrics, trace } from '@opentelemetry/api';
import { describe, expect, it } from 'vitest';
import { resolveTelemetry } from '../../../../src/ArvoEventHandler/context/telemetry/resolve.js';

describe('resolving where a party records', () => {
  it('takes each part it is given', () => {
    const tracer = trace.getTracer('given');
    const meter = metrics.getMeter('given');
    const logger = { emit: () => undefined };
    const resolved = resolveTelemetry({ tracer, meter, logger });
    expect(resolved.tracer).toBe(tracer);
    expect(resolved.meter).toBe(meter);
    expect(resolved.logger).toBe(logger);
  });

  it('records through the global tracer, with no meter or logger, where nothing is given', () => {
    const resolved = resolveTelemetry(undefined);
    expect(resolved.tracer).toBeDefined();
    expect(resolved.meter).toBeNull();
    expect(resolved.logger).toBeNull();
  });

  it('fills in only what is missing', () => {
    const logger = { emit: () => undefined };
    const resolved = resolveTelemetry({ logger });
    expect(resolved.logger).toBe(logger);
    expect(resolved.meter).toBeNull();
  });

  it('takes a meter or logger given as null, as untyped code could, as none', () => {
    const resolved = resolveTelemetry({
      // @ts-expect-error deliberately invalid: null from code no type checker saw
      meter: null,
      // @ts-expect-error deliberately invalid: null from code no type checker saw
      logger: null,
    });
    expect(resolved.meter).toBeNull();
    expect(resolved.logger).toBeNull();
  });

  it('is frozen', () => {
    expect(Object.isFrozen(resolveTelemetry(undefined))).toBe(true);
  });
});
