/**
 * Which task queue carries which work.
 *
 * Two, because the two kinds fail differently under load. A run is a
 * loop that spends its time waiting on deliveries; a record is read and
 * written by every one of them. Keeping records on their own queue means
 * a run that fans out widely cannot leave its own records unable to get
 * a worker.
 */

/** Carries the runs, and the deliveries they make. */
export const RUN_QUEUE = 'arvo-run';

/** Carries the records. */
export const RECORD_QUEUE = 'arvo-record';

/** Every queue a worker must listen on for a run to finish. */
export const QUEUES = [RUN_QUEUE, RECORD_QUEUE] as const;
