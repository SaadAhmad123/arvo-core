/**
 * One recording, which never decides whether an execution went on.
 *
 * A failed recording is written to `console.warn`, every time it fails,
 * and nothing else happens: an execution is never refused for what was
 * only watching it.
 *
 * @param record - What to record, which may throw.
 *
 * @example
 * ```typescript
 * recording(() => span.setAttributes({ 'arvo.subject': subject }));
 * ```
 */
export const recording = (record: () => void): void => {
  try {
    record();
  } catch (refused) {
    console.warn(
      'arvo: a telemetry recording failed, and the execution carried on without it',
      refused,
    );
  }
};

/**
 * One reading of the span, or what stands in where it will not answer.
 *
 * A failed reading is written to `console.warn` and `instead` is used,
 * so a span that refuses to say what trace it is on costs an event its
 * trace context rather than costing the workflow.
 *
 * @param read - What to read, which may throw.
 * @param instead - What to use where it does.
 *
 * @example
 * ```typescript
 * const traceparent = reading(() => contextOf(span).traceparent, null);
 * ```
 */
export const reading = <TRead>(read: () => TRead, instead: TRead): TRead => {
  try {
    return read();
  } catch (refused) {
    console.warn(
      'arvo: a telemetry reading failed, and the execution carried on without it',
      refused,
    );
    return instead;
  }
};
