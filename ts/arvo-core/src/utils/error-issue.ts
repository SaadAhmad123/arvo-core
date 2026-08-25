import { truncate } from './index.js';

/** Longest rendering of a value in an error message before it is truncated. */
export const MAX_DESCRIBED_VALUE_LENGTH = 80;

/**
 * Renders a value for an error message: readable, bounded, and unambiguous
 * about type. `"3"` and `3` must not look alike in a message explaining that
 * one of them is the wrong type.
 *
 * Shared by every error type in this package that reports an offending
 * value — {@link ErrorIssue}'s `received` and
 * `CloudEventTransformationErrorDetail`'s `cause` alike — so the same value
 * looks the same regardless of which boundary reported it.
 */
export const describeValue = (value: unknown): string => {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'string') {
    return truncate(JSON.stringify(value), MAX_DESCRIBED_VALUE_LENGTH);
  }
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  if (typeof value === 'bigint') return `${value}n (bigint)`;
  if (typeof value === 'function') return 'a function';
  if (typeof value === 'symbol') return value.toString();
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (Array.isArray(value)) return `an array of ${value.length}`;

  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) return 'an object';
    return truncate(serialized, MAX_DESCRIBED_VALUE_LENGTH);
  } catch {
    // Cyclic or otherwise unserializable — the shape is what matters here.
    return 'an object';
  }
};

/**
 * The parts of an {@link ErrorIssue}.
 *
 * A single object rather than positional arguments, so a call site reads as
 * the sentence it produces and the optional parts can be left out without a
 * placeholder.
 */
export type ErrorIssueParam = {
  /**
   * Where the problem is: a field name (`dataschema`), a path into a payload
   * (`data.items[2].price`), a named part of a compound value (`major`), or
   * the fields a combined rule spans (`parentid + depth`).
   */
  path: string;

  /**
   * What is wrong with the value at {@link path}, readable without the source
   * at hand — `must not be empty`, not `failed check 3`.
   *
   * About the value alone. Use {@link blockingReason} to say why nothing else
   * was checked.
   */
  message: string;

  /** The offending value. Omit it when showing it would not help. */
  received?: unknown;

  /**
   * Why no further rules ran, when this issue is what stopped them. Supplying
   * it is what marks the issue as blocking.
   *
   * Empty or whitespace-only is treated as absent.
   */
  blockingReason?: string;
};

/**
 * A single rule that a value failed, and the vocabulary every validating
 * boundary in this package reports in.
 *
 * One shared type rather than one per module: an event's structural rules, a
 * CloudEvent's transformation rules, and a semantic version's grammar are
 * different rules about different things, but "which part, what is wrong,
 * what was there instead" is the same three questions in each case. A caller
 * handling issues from two boundaries should not have to handle two shapes.
 *
 * A class rather than a plain object because rendering belongs with the
 * data. {@link toString} is the single definition of how an issue reads, so
 * a module that reports issues never has to know how to format one.
 *
 * Lives in `utils/` so that every module can depend on it downward. A module
 * owning this type would force its peers to depend sideways on that module
 * for a concept none of them get from it.
 */
export class ErrorIssue {
  /**
   * Identifies an issue without an `instanceof` check, and survives
   * serialization, so an issue that crosses a wire stays identifiable.
   */
  readonly _tag = 'ErrorIssue';

  /** Why no further rules ran, or `null` if this issue stopped nothing. */
  readonly blockingReason: string | null;

  /** Whether this issue is the one that stopped the run. */
  readonly isBlocking: boolean;

  /** Where the problem is. */
  readonly path: string;

  /** What is wrong with the value at {@link path}. */
  readonly message: string;

  /**
   * The offending value. Absent and `undefined` are indistinguishable, and
   * both render without a `received` clause — a rule about a value being
   * `undefined` should say so in its {@link message}.
   */
  readonly received?: unknown;

  /** @param param - The issue's parts. See {@link ErrorIssueParam}. */
  constructor(param: ErrorIssueParam) {
    this.path = param.path;
    this.message = param.message;
    this.received = param.received;
    this.blockingReason = param.blockingReason?.trim() || null;
    this.isBlocking = this.blockingReason !== null;
    Object.freeze(this);
  }

  /**
   * One line: where, what, what was received, and — when this issue is
   * blocking — why nothing after it was checked.
   *
   * The `received` clause is omitted entirely when no value was supplied,
   * rather than rendered as `(received undefined)`.
   */
  toString(): string {
    const received =
      this.received === undefined
        ? ''
        : ` (received ${describeValue(this.received)})`;
    const blocking = this.blockingReason
      ? ` — nothing after this was checked: ${this.blockingReason}`
      : '';
    return `${this.path}: ${this.message}${received}${blocking}`;
  }
}

/**
 * Builds the message of an error that reports {@link ErrorIssue}s, from a
 * heading and every issue found.
 *
 * One shape whenever there is anything to report: the heading, a line
 * introducing the issues, then one indented line each. A single issue is not
 * special-cased — an error that reads the same way regardless of how many
 * rules broke is easier to scan, and easier to write an expectation against.
 *
 * The count is stated rather than hedged with `(s)`, because it tells a
 * reader whether they are looking at the whole list before they scroll.
 *
 * Callers are expected to pass every issue they evaluated, rather than
 * stopping at the first: an event has eighteen fields, and being told about
 * them one run at a time is a poor way to find out that four are wrong. The
 * exception is a blocking issue — a boundary that stopped because a value the
 * remaining rules depend on was itself invalid passes what it got that far.
 *
 * `message` is a complete heading, emitted verbatim on its own line with its
 * own punctuation. With no issues it is the whole message, which is what an
 * error carrying an empty issue list should say.
 *
 * When one of the issues is blocking, a closing line says the list is
 * partial. Read off the issues themselves rather than passed in separately,
 * so there is nothing to keep in step: the issue that stopped the run is the
 * one that says so, and it already carries the reason in its own rendering.
 *
 * @param message - The heading, already punctuated.
 * @param issues - Every rule the value broke that was evaluated.
 */
export const buildErrorIssueMessage = (
  message: string,
  issues: readonly ErrorIssue[],
): string => {
  const note = issues.some((issue) => issue.isBlocking)
    ? '\nThis is not the whole list — checking stopped at the problem above.'
    : '';
  if (issues.length === 0) return `${message}${note}`;
  const preamble =
    issues.length === 1
      ? 'The following problem was found:'
      : `The following ${issues.length} problems were found:`;
  const lines = issues.map((issue) => `  - ${issue.toString()}`).join('\n');
  return `${message}\n${preamble}\n${lines}${note}`;
};
