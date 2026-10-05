import type { ActivityOptions } from '@temporalio/workflow';

/**
 * How Temporal is told to retry.
 *
 * The retry budget is the handler's: it declares one, and every fault it
 * raises says whether a further attempt is in prospect
 * (`docs/adr/009-arvoeventhandler-bounds-and-defaults.md`). The policy
 * here is deliberately wider than any handler's budget, so a delivery
 * stops because a fault said so rather than because Temporal ran out —
 * one source of truth instead of two numbers that must agree.
 *
 * The interval is a fallback for the same reason. What governs is the
 * delay the fault asks for, carried on the failure itself.
 */

/** The outside limit, so a fault wrongly promising a retry cannot loop forever. */
export const ATTEMPT_CEILING = 50;

/** How the activity that runs one delivery is scheduled. */
export const DELIVERY_ACTIVITY: ActivityOptions = {
  startToCloseTimeout: '2 minutes',
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
