import type { ActivityOptions } from '@temporalio/workflow';

/**
 * What Temporal is told about retrying, declared rather than inherited.
 *
 * ADR-006 says every retry is a fresh delivery with the attempt number
 * incremented, and ADR-009 says how many are allowed — which the handler
 * declares and every fault it raises reports. So there are two possible
 * designs here, and only one of them can be right.
 *
 * Copying the handler's budget into a Temporal policy would mean two
 * numbers that have to agree, and they would not for long. Instead the
 * policy is deliberately wider than any handler's budget, and an
 * execution stops being retried because a fault said no further attempt
 * is in prospect. The fault is the budget; this is only the backstop
 * that stops a fault wrongly reporting a retry forever from occupying a
 * worker forever.
 *
 * The delay is the same story: the policy's interval is a fallback, and
 * what actually governs is the delay the fault asked for, carried across
 * the boundary on the failure itself.
 *
 * Shared with the workflow, so it is one declaration rather than two.
 */

/** How many times Temporal will attempt one execution at the outside. */
export const ATTEMPT_CEILING = 50;

/** How the activity that runs one execution is scheduled. */
export const EXECUTION_ACTIVITY: ActivityOptions = {
  // Long enough for the widest execution in the run to rebuild its whole
  // collection, and short enough that a worker that has wedged is noticed.
  startToCloseTimeout: '2 minutes',
  // It says it is alive before it begins, so a killed worker is noticed
  // in seconds rather than at the start-to-close timeout.
  heartbeatTimeout: '30 seconds',
  retry: {
    initialInterval: '1 second',
    backoffCoefficient: 2,
    maximumInterval: '30 seconds',
    maximumAttempts: ATTEMPT_CEILING,
  },
};

/** How the bookkeeping either side of a dispatch is scheduled. */
export const BOOKKEEPING_ACTIVITY: ActivityOptions = {
  startToCloseTimeout: '30 seconds',
  retry: {
    initialInterval: '1 second',
    backoffCoefficient: 2,
    maximumInterval: '10 seconds',
    maximumAttempts: 10,
  },
};
