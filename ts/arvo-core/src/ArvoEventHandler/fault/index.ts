import type { JSONObject } from '../../types.js';
import type {
  ArvoFaultKind,
  ArvoFaultRetry,
  ArvoHandlerFaultParam,
} from './types.js';

/**
 * Why an execution could not be carried through.
 *
 * Not a failure of the work — that reaches a caller as the contract's
 * handler error event. This says the execution could not be trusted to a
 * conclusion, so nothing is emitted and no record is written.
 *
 * An `Error`, and every field survives JSON, for whatever stores it.
 *
 * @example
 * ```typescript
 * try {
 *   await handler.execute({ event });
 * } catch (raised) {
 *   if (raised instanceof ArvoHandlerFault) {
 *     raised.faultKind;        // what to do, without reading the message
 *     raised.retry;            // when another attempt is due, or null
 *     raised.abandonmentEvent; // what to publish on giving up
 *   }
 * }
 * ```
 */
export class ArvoHandlerFault extends Error {
  /** Identifies this error without an `instanceof` check, and survives JSON. */
  readonly _tag = 'ArvoHandlerFault';

  /** Which fault this is. */
  readonly faultKind: ArvoFaultKind;

  /** The underlying failure as a string, or `null` where nothing underlies it. */
  override readonly cause: string | null;

  /** Every check that failed, not only the first. */
  readonly violations: readonly string[];

  /** The workflow this execution belonged to. */
  readonly subject: string;

  /** The execution this execution concerned, or `null` where none was resolved. */
  readonly executionId: string | null;

  /** The event that caused it's id. */
  readonly eventId: string;

  /** Which attempt this execution was, counting from 0. */
  readonly attempt: number;

  /** When this execution was processed, as ms since the Unix epoch. */
  readonly timestamp: number;

  /** When another attempt is due, or `null` where none is in prospect. */
  readonly retry: ArvoFaultRetry | null;

  /**
   * The event to publish if this execution is abandoned, written out, or
   * `null` where the execution could address nothing. Not acted on by
   * raising the fault.
   */
  readonly abandonmentEvent: string | null;

  /** The record to commit alongside {@link abandonmentEvent}, written out. */
  readonly abandonmentState: string | null;

  constructor(param: ArvoHandlerFaultParam) {
    super(param.message);
    this.name = this._tag;
    this.faultKind = param.faultKind;
    this.cause = param.cause;
    this.violations = Object.freeze([...param.violations]);
    this.subject = param.subject;
    this.executionId = param.executionId;
    this.eventId = param.eventId;
    this.attempt = param.attempt;
    this.timestamp = param.timestamp;
    this.retry = param.retry;
    this.abandonmentEvent = param.abandonmentEvent;
    this.abandonmentState = param.abandonmentState;
    Object.freeze(this);
  }

  /**
   * The whole fault as JSON, for whatever stores it.
   *
   * Includes `name`, `message` and `stack`, which an `Error` serializes
   * none of. The abandonment pair arrives already written out.
   */
  toJSON(): JSONObject {
    return {
      name: this.name,
      faultKind: this.faultKind,
      message: this.message,
      cause: this.cause,
      stack: this.stack ?? null,
      violations: [...this.violations],
      subject: this.subject,
      executionId: this.executionId,
      eventId: this.eventId,
      attempt: this.attempt,
      timestamp: this.timestamp,
      retry: this.retry === null ? null : { ...this.retry },
      abandonmentEvent: this.abandonmentEvent,
      abandonmentState: this.abandonmentState,
    } as JSONObject;
  }
}
