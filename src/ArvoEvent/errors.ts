import { truncate } from '../utils.js';

/** A single structural rule that an event failed. */
export type ArvoEventValidationIssue = {
  /**
   * Where the problem is: a field name (`dataschema`), a dotted path into
   * the payload (`data.items[2].price`), or the fields a combined rule spans
   * (`parentid + depth`).
   */
  path: string;
  /** What is wrong with the value at `path`. */
  message: string;
  /** The offending value. Absent when showing it would not help. */
  received?: unknown;
};

/** Longest rendering of a received value before it is truncated. */
const MAX_RECEIVED_LENGTH = 80;

/**
 * Renders a value for an error message: readable, bounded, and unambiguous
 * about type. `"3"` and `3` must not look alike in a message explaining that
 * one of them is the wrong type.
 */
const describeValue = (value: unknown): string => {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'string') {
    return truncate(JSON.stringify(value), MAX_RECEIVED_LENGTH);
  }
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  if (typeof value === 'bigint') return `${value}n (bigint)`;
  if (typeof value === 'function') return 'a function';
  if (typeof value === 'symbol') return value.toString();
  if (Array.isArray(value)) return `an array of ${value.length}`;

  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) return 'an object';
    return truncate(serialized, MAX_RECEIVED_LENGTH);
  } catch {
    // Cyclic or otherwise unserializable — the shape is what matters here.
    return 'an object';
  }
};

/** Renders one issue as a single line: where, what, and what was received. */
const formatIssue = (issue: ArvoEventValidationIssue): string => {
  const received =
    'received' in issue ? ` (received ${describeValue(issue.received)})` : '';
  return `${issue.path}: ${issue.message}${received}`;
};

/**
 * Builds the message shown when construction fails.
 *
 * A single failure reads as one sentence. Several read as a list, because an
 * event has eighteen fields and being told about them one run at a time is a
 * poor way to find out that four are wrong.
 */
const formatMessage = (issues: ArvoEventValidationIssue[]): string => {
  if (issues.length === 0) return 'ArvoEvent is not structurally valid.';
  if (issues.length === 1)
    return `ArvoEvent is not structurally valid. ${formatIssue(issues[0] as ArvoEventValidationIssue)}`;
  const lines = issues.map((issue) => `  - ${formatIssue(issue)}`).join('\n');
  return `ArvoEvent is not structurally valid (${issues.length} problems):\n${lines}`;
};

/**
 * Thrown when an event is structurally invalid.
 *
 * This means the event itself is malformed — a missing field, a value of the
 * wrong shape, or a combination of fields that cannot occur together. It does
 * not mean the payload failed contract validation, which is a separate check.
 *
 * The message names every rule that was broken, so it can be acted on without
 * reading this source. {@link issues} carries the same information
 * individually for callers that would rather present it their own way.
 *
 * @see docs/adr/001-arvoevent-structure.md for the full field definitions and
 * structural rules.
 */
export class ArvoEventValidationError extends Error {
  /** Discriminant for identifying this error without an `instanceof` check. */
  readonly _tag = 'ArvoEventValidationError';

  /** Every rule the event broke, not merely the first one found. */
  readonly issues: readonly ArvoEventValidationIssue[];

  /**
   * @param issues - Every structural rule the event failed.
   * @param options - Standard `ErrorOptions`. Pass `cause` to preserve an
   * underlying error where one exists.
   */
  constructor(issues: ArvoEventValidationIssue[], options?: ErrorOptions) {
    super(formatMessage(issues), options);
    this.name = this._tag;
    this.issues = Object.freeze([...issues]);
  }
}
