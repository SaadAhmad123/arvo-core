import { ErrorIssue } from '../../../utils/error-issue.js';
import type { ArvoExecutionContextTelemetryParam } from './types.js';

/** What a span must answer to, for anything here to record against it. */
const SPAN_ANSWERS = [
  'spanContext',
  'setAttributes',
  'addEvent',
  'setStatus',
  'recordException',
] as const;

/** What a meter must answer to, where one was given at all. */
const METER_ANSWERS = ['createCounter', 'createHistogram'] as const;

/** Whether this value answers to each of those by name. */
const answersTo = (held: unknown, named: readonly string[]): string[] =>
  named.filter(
    (name) => typeof (held as Record<string, unknown>)?.[name] !== 'function',
  );

/**
 * Every way what an execution would record against is not something it
 * can, or none where it is.
 *
 * Shape alone. A span is required, since every event an execution emits
 * takes its trace from one; a meter and a logger may each be `null`,
 * which collects nothing and is no error.
 *
 * @param param - What telemetry would be built from.
 *
 * @example
 * ```typescript
 * const broken = checkTelemetry({ span, meter: {}, logger: null });
 * if (broken.length > 0) refuse(broken);
 * ```
 */
export const checkTelemetry = (
  param: ArvoExecutionContextTelemetryParam,
): ErrorIssue[] => {
  const issues: ErrorIssue[] = [];

  const spanMissing = answersTo(param.span, SPAN_ANSWERS);
  if (param.span === null || param.span === undefined) {
    issues.push(
      new ErrorIssue({
        path: 'span',
        message:
          'must be an OpenTelemetry span, every event an execution emits taking its trace from one',
        received: param.span,
      }),
    );
  } else if (spanMissing.length > 0) {
    issues.push(
      new ErrorIssue({
        path: 'span',
        message: `must be an OpenTelemetry span, and this answers to none of ${spanMissing.join(', ')}`,
        received: param.span,
      }),
    );
  }

  const meterMissing = answersTo(param.meter, METER_ANSWERS);
  if (param.meter !== null && meterMissing.length > 0) {
    issues.push(
      new ErrorIssue({
        path: 'meter',
        message: `must be an OpenTelemetry meter, or null where nothing is metering, and this answers to none of ${meterMissing.join(', ')}`,
        received: param.meter,
      }),
    );
  }

  if (
    param.logger !== null &&
    typeof (param.logger as { emit?: unknown })?.emit !== 'function'
  ) {
    issues.push(
      new ErrorIssue({
        path: 'logger',
        message:
          'must be something that emits a log record, or null where nothing is collecting them',
        received: param.logger,
      }),
    );
  }

  return issues;
};
