import type { VersionedArvoContract } from '../../ArvoContract/versioned/index.js';
import type { ArvoEvent } from '../../ArvoEvent/index.js';
import type { ArvoExecutionContextTelemetry } from '../context/telemetry/index.js';
import type { ArvoExecutionState } from '../state/index.js';
import type { ArvoEventHandlerOptions } from '../types/options.js';

/**
 * Every way an execution can fail to be carried through.
 *
 * Fixed, and the whole of the vocabulary: a mechanism reads this to decide
 * what to do without parsing a message. Which of these may be retried is a
 * property of the kind, and is stated where each is raised.
 */
export type ArvoFaultKind =
  // the gate, in the order its steps run
  | 'event_unclassifiable'
  | 'category_mismatch'
  | 'state_resolution_failed'
  | 'record_unexpected'
  | 'record_expected'
  | 'record_invalid'
  | 'record_event_unrestorable'
  | 'version_not_declared'
  | 'max_depth_event_received'
  | 'lifecycle_terminal'
  | 'execution_timeout'
  | 'event_unaddressed'
  | 'addressing_mismatch'
  | 'type_not_receivable'
  | 'event_schema_rejected'
  | 'response_unawaited'
  | 'dependency_resolution_failed'
  // a declaration that reached an execution
  | 'service_version_conflict'
  // the executor
  | 'run_timeout'
  | 'execution_cancelled'
  | 'executor_raised'
  // what it returned, and what it wrote
  | 'emission_not_permitted'
  | 'emission_schema_rejected'
  | 'max_depth_event_requested'
  | 'state_schema_rejected'
  | 'state_not_serializable';

/**
 * When another attempt may be made, where one is in prospect.
 *
 * Milliseconds throughout: the two instants as milliseconds since the Unix
 * epoch, the delay as a count of them, so `retryAt` is `timestamp` plus
 * `retryInMs` and needs no conversion rule.
 */
export type ArvoFaultRetry = {
  /** How many attempts the version allows, counting from 0. */
  readonly maxRetryAttemptsAllowed: number;
  /** How long to wait before the next attempt. */
  readonly retryInMs: number;
  /** When the next attempt is due. */
  readonly retryAt: number;
};

/**
 * What a fault is built from.
 *
 * No field is optional. A fault is raised by code that knows the execution it
 * happened on, and an omitted field would mean nobody decided rather than
 * that there was nothing to say. Where there is nothing to say, say `null`.
 */
export type ArvoHandlerFaultParam = {
  /** Which fault this is. */
  faultKind: ArvoFaultKind;
  /** What failed, the value involved, and the rule broken. */
  message: string;
  /** The underlying failure as a string, or `null` where nothing underlies it. */
  cause: string | null;
  /** Every check that failed, not only the first. Empty where none was collected. */
  violations: readonly string[];

  /** The workflow this execution belonged to. */
  subject: string;
  /** The execution this execution concerned, or `null` where none was resolved. */
  executionId: string | null;
  /** The event that caused it's id. */
  eventId: string;

  /** Which attempt this execution was, counting from 0. */
  attempt: number;
  /** When this execution was processed, as ms since the Unix epoch. */
  timestamp: number;
  /** When another attempt is due, or `null` where none is in prospect. */
  retry: ArvoFaultRetry | null;

  /**
   * The event to publish if this execution is abandoned, already written
   * out in the event's own format, or `null` where there is none.
   */
  abandonmentEvent: string | null;
  /** The record to commit alongside it, written out, or `null`. */
  abandonmentState: string | null;
};

/** What describing one execution's failure takes. */
export type ArvoHandlerFaultFactoryParam = {
  /** The version of the contract the failing execution implements. */
  contracts: { self: VersionedArvoContract };
  /** The options in force, which decide the retry verdict and the domain. */
  options: ArvoEventHandlerOptions;
  /** Which attempt failed, counting from 0. */
  attempt: number;
  /** Where the fault is written as it is built. */
  telemetry: ArvoExecutionContextTelemetry;
  /** Which fault this is, from the fixed vocabulary. */
  faultKind: ArvoFaultKind;
  /** What failed, readable without the source at hand. */
  message: string;
  /** The underlying failure as a string. Omit where nothing underlies it. */
  cause?: string;
  /** Every check that failed. Omit where none was collected. */
  violations?: readonly string[];
  /**
   * Whether another attempt could fix this. Consulted for
   * `executor_raised` alone, where the answer is yes unless stated
   * otherwise; every other kind carries the verdict its vocabulary fixes.
   */
  retryable?: boolean;
} & (
  | {
      /**
       * What the execution remembers, which answers everything else the
       * fault names.
       */
      state: ArvoExecutionState;
    }
  | {
      /**
       * No record, the failure having happened before one could be read.
       * What a record would have answered is then asked for directly.
       */
      state: null;
      /** The event that caused this execution. */
      event: ArvoEvent;
      /**
       * The event that opened the execution, where that is known. `null`
       * on a response, whose own source is the service rather than the
       * caller, leaving nobody to address.
       */
      initEvent: ArvoEvent | null;
      /** The execution being looked for, or `null` where none was resolved. */
      executionId: string | null;
    }
);
