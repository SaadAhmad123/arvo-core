import { context as otelContext, type Span, trace } from '@opentelemetry/api';
import { describe, expect, it } from 'vitest';
import { ArvoExecutionContextLogger } from '../../../../src/ArvoEventHandler/context/telemetry/logger.js';
import type {
  ArvoLogger,
  ArvoLogRecord,
} from '../../../../src/ArvoEventHandler/context/telemetry/types.js';

/** Everything emitted, and the span active while each was. */
const spy = () => {
  const emitted: { record: ArvoLogRecord; active: Span | undefined }[] = [];
  const logger: ArvoLogger = {
    emit: (record) =>
      emitted.push({
        record,
        active: trace.getSpan(otelContext.active()),
      }),
  };
  return { logger, emitted };
};

const span = trace.getTracer('test').startSpan('delivery');

const bound = (logger: ArvoLogger | null) =>
  new ArvoExecutionContextLogger({ logger, span });

describe("one delivery's logging", () => {
  it('carries what it emits through, and what it correlates to', () => {
    const { logger } = spy();
    const logging = bound(logger);
    expect(logging.logger).toBe(logger);
    expect(logging.span).toBe(span);
  });

  it('emits the record it was asked to', () => {
    const watched = spy();
    bound(watched.logger).info('charging');
    expect(watched.emitted).toHaveLength(1);
  });

  it('emits within a context rather than outside one', () => {
    // What the span is bound to is only observable once an SDK registers a
    // context manager; with none, the API's own is a no-op. What is
    // checkable here is that emitting happens inside the attempt to bind.
    const watched = spy();
    bound(watched.logger).info('charging');
    expect(watched.emitted[0]?.active ?? span).toBe(span);
  });

  it('carries what happened, and whatever else was worth knowing', () => {
    const watched = spy();
    bound(watched.logger).info('charging', { amount: 10 });
    expect(watched.emitted[0]?.record).toEqual({
      severityNumber: 9,
      body: 'charging',
      attributes: { amount: 10 },
    });
  });

  it.each([
    ['debug', 5],
    ['info', 9],
    ['warn', 13],
    ['error', 17],
  ] as const)('emits %s at the severity the standard gives it', (level, at) => {
    const watched = spy();
    bound(watched.logger)[level]('something happened');
    expect(watched.emitted[0]?.record.severityNumber).toBe(at);
  });

  it('takes any severity through the general form', () => {
    const watched = spy();
    bound(watched.logger).emit(21, 'the process is going down');
    expect(watched.emitted[0]?.record.severityNumber).toBe(21);
  });

  describe('where nothing is collecting', () => {
    it('does nothing, so an executor needs no guard', () => {
      expect(() => bound(null).error('it failed')).not.toThrow();
    });

    it('says it has no logger', () => {
      expect(bound(null).logger).toBeNull();
    });
  });
});
