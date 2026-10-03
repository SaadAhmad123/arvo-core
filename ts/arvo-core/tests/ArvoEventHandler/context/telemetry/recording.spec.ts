import { type Span, trace } from '@opentelemetry/api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArvoExecutionContextTelemetryValidationError } from '../../../../src/ArvoEventHandler/context/telemetry/errors.js';
import { ArvoExecutionContextTelemetry } from '../../../../src/ArvoEventHandler/context/telemetry/index.js';

/**
 * What happens where the thing watching an execution is broken.
 *
 * Two different failures. Something that cannot be recorded against at
 * all is wiring, and is refused where it is handed over. Something that
 * works and then stops is operational, and must never decide whether the
 * work gets done.
 */

const aSpan = () => trace.getTracer('recording').startSpan('execution');

/** A span that refuses everything asked of it. */
const refusing = (): Span => {
  const real = aSpan();
  return new Proxy(real, {
    get(held, named) {
      if (named === 'spanContext') return () => held.spanContext();
      return () => {
        throw new Error(`the collector refused ${String(named)}`);
      };
    },
  }) as Span;
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('what an execution may be told to record against', () => {
  it('is a span, with or without anything else', () => {
    expect(
      new ArvoExecutionContextTelemetry({
        span: aSpan(),
        meter: null,
        logger: null,
      }),
    ).toBeInstanceOf(ArvoExecutionContextTelemetry);
  });

  it('is never nothing, every event taking its trace from one', () => {
    expect(
      () =>
        new ArvoExecutionContextTelemetry({
          span: null as unknown as Span,
          meter: null,
          logger: null,
        }),
    ).toThrow(ArvoExecutionContextTelemetryValidationError);
  });

  it('is never something that merely looks like a span', () => {
    try {
      new ArvoExecutionContextTelemetry({
        span: { setAttributes: () => undefined } as unknown as Span,
        meter: null,
        logger: null,
      });
    } catch (refused) {
      const named = refused as ArvoExecutionContextTelemetryValidationError;
      expect(named.issues[0]?.path).toBe('span');
      expect(named.message).toContain('addEvent');
      return;
    }
    throw new Error('expected that span to be refused');
  });

  it('is never a meter that does not meter', () => {
    try {
      new ArvoExecutionContextTelemetry({
        span: aSpan(),
        meter: {} as never,
        logger: null,
      });
    } catch (refused) {
      const named = refused as ArvoExecutionContextTelemetryValidationError;
      expect(named.issues[0]?.path).toBe('meter');
      return;
    }
    throw new Error('expected that meter to be refused');
  });

  it('is never a logger that cannot emit', () => {
    try {
      new ArvoExecutionContextTelemetry({
        span: aSpan(),
        meter: null,
        logger: { log: () => undefined } as never,
      });
    } catch (refused) {
      const named = refused as ArvoExecutionContextTelemetryValidationError;
      expect(named.issues[0]?.path).toBe('logger');
      return;
    }
    throw new Error('expected that logger to be refused');
  });

  it('names everything wrong with it at once', () => {
    try {
      new ArvoExecutionContextTelemetry({
        span: {} as never,
        meter: {} as never,
        logger: {} as never,
      });
    } catch (refused) {
      const named = refused as ArvoExecutionContextTelemetryValidationError;
      expect(named.issues.map((issue) => issue.path)).toEqual([
        'span',
        'meter',
        'logger',
      ]);
      return;
    }
    throw new Error('expected all three to be refused');
  });

  it('is refused where it is handed over, not where an execution runs', () => {
    // the distinction the two halves of this file are about: this is a
    // defect in wiring, and nothing has been asked to do any work yet
    expect(
      () =>
        new ArvoExecutionContextTelemetry({
          span: {} as never,
          meter: null,
          logger: null,
        }),
    ).toThrow(/not something an execution can record against/);
  });
});

describe('a collector that worked and then stopped', () => {
  const quietly = () =>
    new ArvoExecutionContextTelemetry({
      span: refusing(),
      meter: null,
      logger: {
        emit: () => {
          throw new Error('the log pipeline is down');
        },
      },
    });

  it('does not stop an execution recording against it', () => {
    const telemetry = quietly();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(() => telemetry.setAttributes({ subject: 'order-1' })).not.toThrow();
    expect(() => telemetry.addEvent('stage.entered')).not.toThrow();
    expect(() => telemetry.setSpanOk()).not.toThrow();
    expect(() => telemetry.setSpanError('no')).not.toThrow();
    expect(() => telemetry.logger.info('charging')).not.toThrow();
  });

  it('answers with no trace to stamp, rather than refusing to answer', () => {
    const telemetry = quietly();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(telemetry.isRecording).toBe(false);
    expect(telemetry.traceparent).toBeNull();
    expect(telemetry.tracestate).toBeNull();
  });

  it('answers with no trace where the span says it records and then will not', () => {
    const said = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    // a span with a context valid enough to be worth reading, whose
    // trace state then refuses to be read — where an event would
    // otherwise lose its trace without anybody hearing about it
    const real = aSpan();
    const halfThere = new Proxy(real, {
      get(held, named) {
        if (named !== 'spanContext') {
          return (held as unknown as Record<string, unknown>)[named as string];
        }
        return () => ({
          traceId: 'a'.repeat(32),
          spanId: 'b'.repeat(16),
          traceFlags: 1,
          traceState: {
            serialize: () => {
              throw new Error('the collector refused to be read');
            },
          },
        });
      },
    }) as Span;

    const telemetry = new ArvoExecutionContextTelemetry({
      span: halfThere,
      meter: null,
      logger: null,
    });

    expect(telemetry.isRecording).toBe(true);
    expect(telemetry.tracestate).toBeNull();
    expect(said).toHaveBeenCalled();
  });

  it('says so, rather than losing it quietly', () => {
    const said = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    quietly().setAttributes({ subject: 'order-1' });

    expect(said).toHaveBeenCalledTimes(1);
    expect(said.mock.calls[0]?.[0]).toContain('telemetry');
    expect(said.mock.calls[0]?.[1]).toBeInstanceOf(Error);
  });

  it('says so every time, a collector broken on every call being that', () => {
    const said = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const telemetry = quietly();
    for (let at = 0; at < 5; at += 1) {
      telemetry.setAttributes({ subject: `order-${at}` });
    }

    // quietening it would take a count, and a count kept in a module is
    // shared by every handler in the process
    expect(said).toHaveBeenCalledTimes(5);
  });

  it('says so for a meter and a logger as readily as for a span', () => {
    const said = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const telemetry = quietly();

    telemetry.logger.info('charging');
    expect(said).toHaveBeenCalledTimes(1);
  });
});
