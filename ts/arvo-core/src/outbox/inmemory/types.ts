/**
 * One buffer of {@link ArvoMemoryOutbox}: what it is meant to hold, and how
 * far past that it may go.
 *
 * `size` is a whole number greater than zero, and `tolerance` a number from
 * zero to one. The most it holds is `size × (1 + tolerance)`: past `size` it
 * answers `tolerating`, and past that most it refuses a commit as
 * `capacity_exhausted`.
 *
 * @example
 * ```typescript
 * const buffer: ArvoMemoryOutboxBuffer = { size: expectedBacklog, tolerance };
 * ```
 */
export type ArvoMemoryOutboxBuffer = {
  /** What the buffer is meant to hold. */
  readonly size: number;
  /** How far past `size` it may go, as a share of `size`. */
  readonly tolerance: number;
};

/**
 * Options for {@link ArvoMemoryOutbox}. Every option has a default of the
 * outbox's own where left out.
 *
 * The buffers count events and states, not the memory they take: a few very
 * large states can use much more than their count suggests.
 *
 * Each retention must be longer than the longest your queue may take to
 * deliver an event again. A state deleted before then lets a repeated
 * delivery start its execution again.
 *
 * @example
 * ```typescript
 * const options: ArvoMemoryOutboxOptions = {
 *   clock: () => new Date(fixedTime),
 *   buffers: { events: { size: expectedBacklog, tolerance } },
 *   retentionMs: { terminalStates: longestRedeliveryMs },
 * };
 * ```
 */
export type ArvoMemoryOutboxOptions = {
  /**
   * The current time, read for every landing, listing, marking seen and
   * sweep. The system clock where left out.
   */
  readonly clock?: () => Date;
  /**
   * How many events, seen or not, and how many states it holds.
   *
   * Old ones are only thrown away once their retention has passed, so make
   * each buffer at least as big as how many arrive per second times how many
   * seconds they are kept. Smaller, and it fills up and refuses new work.
   */
  readonly buffers?: {
    /** Every event held, seen or not. */
    readonly events?: ArvoMemoryOutboxBuffer;
    /** Every state kept, of executions running or finished. */
    readonly states?: ArvoMemoryOutboxBuffer;
  };
  /**
   * How long it keeps what it no longer needs, in whole milliseconds, zero
   * or more. It sweeps on a timer while open, worked out from the shorter
   * of the two.
   */
  readonly retentionMs?: {
    /** How long after an event is marked seen it is deleted. */
    readonly seenEvents?: number;
    /**
     * How long after its last commit a state at `success`, `error`,
     * `cancelled` or `failure` is deleted. A state at any other lifecycle is
     * never deleted.
     */
    readonly terminalStates?: number;
  };
};
