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
 * @example
 * ```typescript
 * const param: ArvoOutboxUnseenEventsParam = { atMost, olderThanMs };
 * ```
 */
export type ArvoOutboxUnseenEventsParam = {
  /** The most events to list. */
  readonly atMost: number;
  /** How long, in milliseconds, an event must have been committed to be listed. */
  readonly olderThanMs: number;
};
