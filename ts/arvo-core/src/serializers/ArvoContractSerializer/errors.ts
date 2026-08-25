import {
  buildErrorIssueMessage,
  describeValue,
  type ErrorIssue,
} from '../../utils/error-issue.js';

/**
 * Whatever was thrown, as an `Error`.
 *
 * A `throw` can carry anything, and `cause` is declared as an `Error`. The
 * conversions used here throw `Error`s, so the other branch is a guard rather
 * than a path taken -- but a guard that keeps the declared type honest.
 */
export const asError = (thrown: unknown): Error =>
  thrown instanceof Error ? thrown : new Error(String(thrown));

/** The parts of an {@link ArvoContractSerializerError}. */
export type ArvoContractSerializerErrorParam = {
  /**
   * Every rule the input broke, each naming the position that broke it.
   *
   * Empty when the failure was not about any particular position — a string
   * that is not JSON at all, for instance.
   */
  issues?: readonly ErrorIssue[];

  /**
   * The underlying error, when one exists. A `JSON.parse` `SyntaxError` or a
   * `JSON.stringify` `TypeError`, never discarded.
   */
  cause?: Error;
};

/**
 * Thrown when a contract cannot be converted to or from its canonical form.
 *
 * Carries two kinds of detail, either or both of which may be present.
 * {@link issues} names each position that broke a rule — a schema position
 * missing the object keyword, a construct the conversion cannot read, an
 * identifier the contract's own grammar rejects. {@link cause} carries an
 * underlying error where the failure was not about a position at all, such
 * as input that is not JSON.
 *
 * One type rather than two, so a caller does not have to know which layer
 * failed in order to know what to catch.
 *
 * When one of the {@link issues} is blocking, the rules that depend on it were
 * not evaluated and the list is partial — fix what it names and try again.
 */
export class ArvoContractSerializerError extends Error {
  /** Discriminant for identifying this error without an `instanceof` check. */
  readonly _tag = 'ArvoContractSerializerError';

  /** Every rule the input broke. Empty when the failure named no position. */
  readonly issues: readonly ErrorIssue[];

  /** The underlying error, when the failure had one. */
  readonly cause?: Error;

  /**
   * @param message - A complete heading, already punctuated.
   * @param param - Positions that broke a rule, and any underlying error.
   */
  constructor(message: string, param: ArvoContractSerializerErrorParam = {}) {
    const issues = param.issues ?? [];
    super(
      param.cause !== undefined && issues.length === 0
        ? `${message} ${describeValue(param.cause)}`
        : buildErrorIssueMessage(message, issues),
      param.cause === undefined ? undefined : { cause: param.cause },
    );
    this.name = this._tag;
    this.issues = Object.freeze([...issues]);
    if (param.cause !== undefined) this.cause = param.cause;
  }
}
