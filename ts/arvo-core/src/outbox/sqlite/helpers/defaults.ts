/** How long an outbox opened with no `busyTimeoutMs` waits for a file another writer holds. */
export const defaultBusyTimeoutMs = 5000;

/** How long an outbox opened with no `retainSeenEventsForMs` keeps an event once seen. */
export const defaultRetainSeenEventsForMs = 7 * 24 * 60 * 60 * 1000;

/** The most expired events one marking deletes, so marking stays cheap however many expired. */
export const expiredEventsDeletedPerMarking = 500;

/** The most free pages one marking gives back to the disk. */
export const pagesFreedPerMarking = 200;
