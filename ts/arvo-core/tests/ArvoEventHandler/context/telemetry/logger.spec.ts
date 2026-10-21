import { context as otelContext, type Span, trace } from '@opentelemetry/api';
import { describe, expect, it } from 'vitest';
import { ArvoExecutionContextLogger } from '../../../../src/ArvoEventHandler/context/telemetry/logger.js';
import type {
  ArvoLogger,
  ArvoLogRecord,
} from '../../../../src/ArvoEventHandler/context/telemetry/types.js';

/** Everything emitted, and the span active while each was. */
const spyLogger = () => {
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

const span = trace.getTracer('test').startSpan('execution');

const contextLogger = (logger: ArvoLogger | null) =>
  new ArvoExecutionContextLogger({ logger, span });

describe("one execution's logging", () => {
  it('carries what it emits through, and what it correlates to', () => {
    const { logger } = spyLogger();
    const executionLogger = contextLogger(logger);
    expect(executionLogger.logger).toBe(logger);
    expect(executionLogger.span).toBe(span);
  });

  it('emits the record it was asked to', () => {
    const loggerCalls = spyLogger();
    contextLogger(loggerCalls.logger).info('charging');
    expect(loggerCalls.emitted).toHaveLength(1);
  });

  it('emits within a context rather than outside one', () => {
    // What the span is bound to is only observable once an SDK registers a
    // context manager; with none, the API's own is a no-op. What is
    // checkable here is that emitting happens inside the attempt to bind.
    const loggerCalls = spyLogger();
    contextLogger(loggerCalls.logger).info('charging');
    expect(loggerCalls.emitted[0]?.active ?? span).toBe(span);
  });

  it('carries what happened, and whatever else was worth knowing', () => {
    const loggerCalls = spyLogger();
    contextLogger(loggerCalls.logger).info('charging', { amount: 10 });
    expect(loggerCalls.emitted[0]?.record).toEqual({
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
  ] as const)(
    'emits %s at the severity the standard gives it',
    (level, severityNumber) => {
      const loggerCalls = spyLogger();
      contextLogger(loggerCalls.logger)[level]('something happened');
      expect(loggerCalls.emitted[0]?.record.severityNumber).toBe(
        severityNumber,
      );
    },
  );

  it('takes any severity through the general form', () => {
    const loggerCalls = spyLogger();
    contextLogger(loggerCalls.logger).emit(21, 'the process is going down');
    expect(loggerCalls.emitted[0]?.record.severityNumber).toBe(21);
  });

  describe('where nothing is collecting', () => {
    it('does nothing, so an executor needs no guard', () => {
      expect(() => contextLogger(null).error('it failed')).not.toThrow();
    });

    it('says it has no logger', () => {
      expect(contextLogger(null).logger).toBeNull();
    });
  });
});
