/**
 * Which queue carries which work, designed rather than defaulted.
 *
 * One queue for everything looks fine until a five-hundred-wide fan-out
 * arrives: every worker slot fills with leaves, and the one execution
 * waiting for all of them cannot get a slot to notice that they have
 * answered. The run then takes as long as the queue takes to drain and
 * looks, from the outside, like a deadlock.
 *
 * So the things that wait are separated from the things that are waited
 * on. Neither can starve the other, because neither is in the other's
 * queue.
 */

/** The queue carrying executions that wait on other executions. */
export const ORCHESTRATION_QUEUE = 'arvo-orchestration';

/** The queue carrying executions that answer and are done. */
export const LEAF_QUEUE = 'arvo-leaf';

/** Every queue a worker must be listening on for a run to finish. */
export const QUEUES = [ORCHESTRATION_QUEUE, LEAF_QUEUE] as const;

/** Which contracts wait on others, and so belong away from the leaves. */
const WAITS_ON_OTHERS = new Set(['com_order_fulfil', 'com_category_walk']);

/**
 * The queue one contract's executions run on.
 *
 * @param contractType - What the execution implements.
 */
export const queueFor = (contractType: string): string =>
  WAITS_ON_OTHERS.has(contractType) ? ORCHESTRATION_QUEUE : LEAF_QUEUE;
