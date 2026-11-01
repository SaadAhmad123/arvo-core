/**
 * Options for {@link ArvoSqliteOutbox}.
 *
 * @example
 * ```typescript
 * const options: ArvoSqliteOutboxOptions = {
 *   filename: '/var/lib/orders/outbox.sqlite',
 *   busyTimeoutMs,
 *   retentionMs: { terminalStates: longestRedeliveryMs },
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
   * How long it keeps what it no longer needs, in whole milliseconds, zero
   * or more, or `Infinity` to keep it forever. Each a default of the
   * outbox's own where left out. Make each longer than your queue may take
   * to deliver an event again: a state deleted before then lets a repeated
   * delivery start its execution again, and a delivery redelivered after
   * its events are deleted finds nothing to resend.
   */
  readonly retentionMs?: {
    /** How long after an event is marked seen it may be deleted. An unseen event never is. */
    readonly seenEvents?: number;
    /**
     * How long after its last commit a state at `success`, `error`,
     * `cancelled` or `failure` may be deleted. A state at any other
     * lifecycle never is.
     */
    readonly terminalStates?: number;
  };
};

/**
 * How many events and how many states {@link ArvoSqliteOutbox.deleteExpired}
 * deleted.
 *
 * @example
 * ```typescript
 * const deletedCounts: ArvoSqliteOutboxDeletedCounts = outbox.deleteExpired();
 * ```
 */
export type ArvoSqliteOutboxDeletedCounts = {
  /** Events seen for longer than the outbox keeps them. */
  readonly events: number;
  /** Terminal states last committed longer ago than the outbox keeps them. */
  readonly states: number;
};
