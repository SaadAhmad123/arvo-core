/**
 * Options for {@link ArvoMemoryOutbox}.
 *
 * @example
 * ```typescript
 * const options: ArvoMemoryOutboxOptions = {
 *   clock: () => new Date(fixedTime),
 *   maxEvents: largestBacklog,
 * };
 * ```
 */
export type ArvoMemoryOutboxOptions = {
  /**
   * The current time, read once per commit and once per listing of unseen
   * events. The system clock where left out.
   */
  readonly clock?: () => Date;
  /**
   * The most event records it holds, seen or not: a whole number greater
   * than zero, and a default of the outbox's own where left out.
   *
   * Where a commit needs room, the events seen longest ago are dropped, no
   * more than it needs, and forgotten: committing one again stores it anew,
   * and reading its delivery no longer finds it. An unseen event is never
   * dropped. Where too few are seen to make room, the commit throws and
   * writes nothing.
   */
  readonly maxEvents?: number;
};
