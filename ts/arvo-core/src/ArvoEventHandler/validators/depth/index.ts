import { err, ok } from 'neverthrow';
import type { ArvoEvent } from '../../../ArvoEvent/index.js';
import { fromNeverthrow } from '../../../result.js';
import type { Result } from '../../../types.js';
import { ErrorIssue } from '../../../utils/error-issue.js';
import type { ArvoFaultKind } from '../../fault/types.js';
import { ArvoEventDepthValidatorError } from './errors.js';
import type { ArvoEventDepthValidatorParam } from './types.js';

/**
 * Judges whether an event sits within the depth a version allows.
 *
 * One threshold, exclusive, applied both when an event arrives and when
 * one is about to be emitted. Reports rather than raising a fault, holding
 * no delivery to describe one with.
 *
 * @example
 * ```typescript
 * const depth = new ArvoEventDepthValidator({ maxDepth: 10 });
 * if (!depth.validateOutput(candidate).ok) return completeInstead();
 * ```
 */
export class ArvoEventDepthValidator {
  /** How deep an execution of this version may sit, or reach. */
  readonly maxDepth: number;

  /** @param param - The bound to judge against. */
  constructor(param: ArvoEventDepthValidatorParam) {
    this.maxDepth = param.maxDepth;
  }

  /**
   * Whether an event arriving may be processed at the depth it carries.
   *
   * @param event - The event that arrived.
   * @returns `true` where it sits below the maximum, else why it does not.
   */
  validateInput(
    event: ArvoEvent,
  ): Result<boolean, ArvoEventDepthValidatorError> {
    return this.#judge(
      event,
      'max_depth_event_received',
      'arrived from deeper than this version accepts',
    );
  }

  /**
   * Whether an event about to be emitted may carry the depth it carries.
   *
   * An event completing an execution carries that execution's own depth,
   * which was already judged on arrival, so it can only fail here if
   * something overrode it.
   *
   * @param event - The event to be emitted.
   * @returns `true` where it sits below the maximum, else why it does not.
   */
  validateOutput(
    event: ArvoEvent,
  ): Result<boolean, ArvoEventDepthValidatorError> {
    return this.#judge(
      event,
      'max_depth_event_requested',
      'would sit deeper than this version allows',
    );
  }

  /** One event against the one threshold, under the kind for where it was found. */
  #judge(
    event: ArvoEvent,
    faultKind: ArvoFaultKind,
    what: string,
  ): Result<boolean, ArvoEventDepthValidatorError> {
    if (event.depth < this.maxDepth) return fromNeverthrow(ok(true));
    return fromNeverthrow(
      err(
        new ArvoEventDepthValidatorError(faultKind, `${event.type} ${what}.`, [
          new ErrorIssue({
            path: 'depth',
            message: `must be below the ${this.maxDepth} this version allows`,
            received: event.depth,
          }),
        ]),
      ),
    );
  }
}
