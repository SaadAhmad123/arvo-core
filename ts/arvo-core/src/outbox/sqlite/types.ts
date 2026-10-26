/**
 * Options for {@link ArvoSqliteOutbox}.
 *
 * @example
 * ```typescript
 * const options: ArvoSqliteOutboxOptions = {
 *   filename: '/var/lib/orders/outbox.sqlite',
 *   busyTimeoutMs,
 *   retainSeenEventsForMs,
 * };
 * ```
 */
export type ArvoSqliteOutboxOptions = {
  /**
   * The SQLite file, created where missing. A file on the machine's own
   * disk, not a network file system.
   */
  readonly filename: string;
  /**
   * How long, in whole milliseconds, an operation waits for the file while
   * another writer holds it, before it throws. A default of the outbox's
   * own where left out.
   */
  readonly busyTimeoutMs?: number;
  /**
   * How long, in whole milliseconds, an event is kept once it has been
   * seen, before it may be deleted; `Infinity` keeps seen events forever.
   * A default of the outbox's own where left out. An unseen event is never
   * deleted.
   *
   * A delivery redelivered after its events are deleted finds nothing to
   * resend, so keep them for longer than a redelivery can arrive late.
   */
  readonly retainSeenEventsForMs?: number;
};
