import type { ArvoEvent } from '../../ArvoEvent/index.js';
import type { JSONObject } from '../../types.js';
import type {
  ArvoFaultKind,
  ArvoFaultRetry,
  ArvoHandlerFaultParam,
} from './types.js';

/**
 * Why a delivery could not be carried through.
 *
 * Not a failure of the work, which is reported to your caller as that
 * contract's handler error event. This says the delivery itself could not
 * be trusted to a conclusion: a precondition it needed, or an obligation it
 * had to meet, was not there. Nothing is emitted and no record is written.
 *
 * An Error, so it can be thrown and caught as one. Also a durable format,
 * because whatever runs the handler may store it and another language may
 * read what it stored, which is why every field survives JSON.
 *
 * @example
 * try {
 *   ctx.setState({ orderId: 42 });
 * } catch (raised) {
 *   if (raised instanceof ArvoHandlerFault) raised.faultKind; // 'state_schema_rejected'
 * }
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

  /** The workflow this delivery belonged to. */
  readonly subject: string;

  /** The execution this delivery concerned, or `null` where none was resolved. */
  readonly executionId: string | null;

  /** The delivered event's id. */
  readonly eventId: string;

  /** Which attempt this delivery was, counting from 0. */
  readonly attempt: number;

  /** When this delivery was processed, as ms since the Unix epoch. */
  readonly timestamp: number;

  /** When another attempt is due, or `null` where none is in prospect. */
  readonly retry: ArvoFaultRetry | null;

  /**
   * The event to publish if this execution is abandoned, or `null` where the
   * delivery could address nothing.
   *
   * Not acted on when the fault is raised. It is what a mechanism sends if
   * it decides to give up, so a caller hears rather than waiting forever.
   */
  readonly abandonmentEvent: ArvoEvent | null;

  /** The record to commit alongside {@link abandonmentEvent}, or `null`. */
  readonly abandonmentState: JSONObject | null;

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
   * `name`, `message` and `stack` are included because an `Error` does not
   * serialize them by default, and a stored fault missing what failed is
   * not worth storing.
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
      abandonmentEvent:
        this.abandonmentEvent === null ? null : { ...this.abandonmentEvent },
      abandonmentState: this.abandonmentState,
    } as JSONObject;
  }
}
