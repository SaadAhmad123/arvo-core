/**
 * Which committed events to read: one execution's, one delivery's, or one
 * delivery's within one execution. A filter names at least one.
 *
 * Recovery reads by `triggeringEventId`, one delivery's worth. Reading by
 * `executionId` alone returns everything that execution ever committed, so
 * keep it for inspection, not for a path that runs on every delivery.
 *
 * Tell the shapes apart with `'executionId' in filter` and
 * `'triggeringEventId' in filter`.
 *
 * @example
 * ```typescript
 * const oneDelivery: ArvoOutboxEventsFilter = { triggeringEventId };
 * const oneExecution: ArvoOutboxEventsFilter = { executionId };
 * ```
 */
export type ArvoOutboxEventsFilter =
  | { readonly executionId: string }
  | { readonly triggeringEventId: string }
  | { readonly executionId: string; readonly triggeringEventId: string };

/**
 * Which unseen events to list.
 *
 * List the events not yet seen, oldest `committedAt` first, at most
 * `atMost` of them, leaving out any that landed less than `olderThanMs`
 * ago by the outbox's own clock. An event exactly `olderThanMs` old is
 * listed.
 *
 * Where `leaseMs` is given, the outbox may claim the events it lists for
 * that long, leaving them out of every other listing until the claim
 * lapses or they are marked seen, so that several sweepers do not all send
 * the same events. An outbox need not honour it: an event listed twice is
 * dropped as a repeat by whoever receives it. Leave `leaseMs` out to claim
 * nothing.
 *
 * @example
 * ```typescript
 * const param: ArvoOutboxUnseenEventsParam = { atMost, olderThanMs, leaseMs };
 * ```
 */
export type ArvoOutboxUnseenEventsParam = {
  /** The most events to list. */
  readonly atMost: number;
  /** How long, in milliseconds, an event must have been committed to be listed. */
  readonly olderThanMs: number;
  /** How long, in whole milliseconds greater than zero, to claim what is listed. */
  readonly leaseMs?: number;
};
