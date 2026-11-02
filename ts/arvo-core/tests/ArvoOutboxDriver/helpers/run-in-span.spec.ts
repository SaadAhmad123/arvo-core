import { err, ok } from 'neverthrow';
import { afterEach, describe, expect, it } from 'vitest';
import { ArvoOutboxDriverError } from '../../../src/ArvoOutboxDriver/errors.js';
import { runInSpan } from '../../../src/ArvoOutboxDriver/helpers/run-in-span.js';
import { fromNeverthrow } from '../../../src/result.js';
import {
  recordingProvider,
  unregisterProviders,
} from '../../recording-provider.js';

afterEach(() => unregisterProviders());

describe('running one driver operation in its span', () => {
  it('names the span for the operation and ends it ok on success', async () => {
    const { tracer, finishedSpans } = recordingProvider();
    const operationResult = await runInSpan({
      operationName: 'markEventsSeen',
      telemetry: { tracer },
      parentSpan: undefined,
      run: async () => fromNeverthrow(ok('marked')),
    });
    expect(operationResult).toEqual({ ok: true, value: 'marked' });
    expect(
      finishedSpans().map((span) => [span.name, span.status.code]),
    ).toEqual([['arvo.outbox_driver.markEventsSeen', 1]]);
  });

  it('hands the operation the span it opened for it', async () => {
    const { tracer, finishedSpans } = recordingProvider();
    await runInSpan({
      operationName: 'commitEvents',
      telemetry: { tracer },
      parentSpan: undefined,
      run: async (operationSpan) => {
        operationSpan.addEvent('capacity');
        return fromNeverthrow(ok(undefined));
      },
    });
    expect(
      finishedSpans()[0]?.events.map((spanEvent) => spanEvent.name),
    ).toEqual(['capacity']);
  });

  it('ends the span as an error carrying the message of a failure answered', async () => {
    const { tracer, finishedSpans } = recordingProvider();
    const failure = new ArvoOutboxDriverError({
      kind: 'unavailable',
      operationName: 'open',
    });
    await runInSpan({
      operationName: 'open',
      telemetry: { tracer },
      parentSpan: undefined,
      run: async () => fromNeverthrow(err(failure)),
    });
    expect(finishedSpans()[0]?.status).toEqual({
      code: 2,
      message: failure.message,
    });
  });

  it('records something thrown that is not an Error, ends the span, and rethrows it as it came', async () => {
    const { tracer, finishedSpans } = recordingProvider();
    await expect(
      runInSpan({
        operationName: 'commitEvents',
        telemetry: { tracer },
        parentSpan: undefined,
        run: async () => {
          // deliberately not an Error, as a caller's code could throw
          throw 'a bare string';
        },
      }),
    ).rejects.toBe('a bare string');
    const [driverSpan] = finishedSpans();
    expect(driverSpan?.status.code).toBe(2);
    expect(driverSpan?.events.map((spanEvent) => spanEvent.name)).toEqual([
      'exception',
    ]);
  });
});
