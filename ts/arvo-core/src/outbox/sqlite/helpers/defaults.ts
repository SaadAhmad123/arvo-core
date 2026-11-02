/** The most expired events, and the most expired states, one marking deletes, so marking stays cheap however many have expired. */
export const expiredRowsDeletedPerMarking = 500;

/** The most free pages one marking gives back to the disk. */
export const pagesFreedPerMarking = 200;

/** The size, in bytes, the log written ahead of is cut back to once checkpointed. */
export const walSizeLimitBytes = 64 * 1024 * 1024;
