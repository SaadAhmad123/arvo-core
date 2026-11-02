/**
 * One event, as an outbox is given it to keep.
 *
 * Arvo builds this from the event; your outbox stores it and hands it back
 * unchanged. Every field but `payload` is there so you can index and find
 * events without opening the payload — keep the ones your storage can use
 * and store the rest as given. Never derive any field from `payload`.
 *
 * @example
 * ```typescript
 * const record: ArvoOutboxEventRecord = {
 *   id: event.id,
 *   subject: event.subject,
 *   executionId: event.executionid,
 *   casVersion: state.casVersion,
 *   parentId: event.parentid,
 *   initId: event.initid,
 *   triggeringEventId: delivered.id,
 *   source: event.source,
 *   type: event.type,
 *   to: event.to,
 *   domain: event.domain,
 *   time: event.time,
 *   payload: cloudEventJson,
 * };
 * ```
 */
export type ArvoOutboxEventRecord = {
  /** The event's identifier: unique across every event, and this record's key. */
  readonly id: string;
  /** The workflow the event belongs to. */
  readonly subject: string;
  /** The execution that committed the event. */
  readonly executionId: string;
  /**
   * The revision of the state the event was committed with, or `null` where
   * it was committed with no state.
   */
  readonly casVersion: number | null;
  /** The event this one directly follows, or `null`. */
  readonly parentId: string | null;
  /** The event that opened the execution this one completes, or `null`. */
  readonly initId: string | null;
  /**
   * The event whose delivery produced this one. Recovery reads by it, so it
   * is the field most worth indexing.
   */
  readonly triggeringEventId: string;
  /** Who emitted the event. */
  readonly source: string;
  /** What the event is. */
  readonly type: string;
  /** Where the event is addressed, or `null`. */
  readonly to: string | null;
  /** The domain the event leaves for, or `null` where it stays. */
  readonly domain: string | null;
  /** When the event was built, as an RFC 3339 instant. */
  readonly time: string;
  /**
   * The event itself, as CloudEvent JSON. Store it as an opaque string and
   * return it exactly as given, character for character: it is what gets
   * resent after a crash.
   */
  readonly payload: string;
};

/**
 * One event, as an outbox hands it back: the record as committed, with the
 * two fields the outbox owns.
 *
 * @example
 * ```typescript
 * const [first]: readonly ArvoOutboxCommittedEventRecord[] =
 *   await outbox.readCommittedEvents({ triggeringEventId });
 * first?.seen; // whether a queue has accepted it
 * ```
 */
export type ArvoOutboxCommittedEventRecord = ArvoOutboxEventRecord & {
  /**
   * When the commit holding this event landed, as an RFC 3339 instant in
   * UTC, written as `Date.prototype.toISOString` writes it. Set once, by
   * the outbox's own clock, never by its caller.
   */
  readonly committedAt: string;
  /** Whether a queue has accepted this event. */
  readonly seen: boolean;
};
