/**
 * What your outbox is asked to make room for: a number of events and, where
 * a state comes with them, that state's revision.
 *
 * What that costs is yours to work out from how you store what you hold. An
 * outbox keeping only each execution's latest state adds one for the first
 * revision and replaces one for every later revision; an outbox keeping
 * every revision adds one each time.
 *
 * @example
 * ```typescript
 * const request: ArvoOutboxCapacityRequest = {
 *   events: records.length,
 *   state: { casVersion },
 * };
 * ```
 */
export type ArvoOutboxCapacityRequest = {
  /** How many events would be committed. */
  readonly events: number;
  /** The state committed with them, where there is one. */
  readonly state?: {
    /** The revision that state claims to be. */
    readonly casVersion: number;
  };
};

/**
 * How much room an outbox would have with what it is asked about added:
 *
 * - `available` — it would stay within what it is meant to hold;
 * - `tolerating` — it would go past what it is meant to hold, but stay within
 *   the most it should ever hold;
 * - `exhausted` — it would go past the most it should ever hold.
 *
 * @example
 * ```typescript
 * const status: ArvoOutboxCapacityStatus = 'tolerating';
 * ```
 */
export type ArvoOutboxCapacityStatus = 'available' | 'tolerating' | 'exhausted';

/**
 * How much room one buffer of an outbox would have. Each number is optional:
 * give the ones you can, and leave out the rest.
 *
 * @example
 * ```typescript
 * const buffer: ArvoOutboxBufferCapacity = {
 *   status: 'tolerating',
 *   held,
 *   size,
 *   limit,
 * };
 * ```
 */
export type ArvoOutboxBufferCapacity = {
  /** How much room this buffer would have. */
  readonly status: ArvoOutboxCapacityStatus;
  /** How much it would hold, with what it is asked about added. */
  readonly held?: number;
  /** What it is meant to hold; past this, it is `tolerating`. */
  readonly size?: number;
  /** The most it should ever hold; past this, it is `exhausted`. */
  readonly limit?: number;
};

/**
 * How much room an outbox would have with what it is asked about added:
 * for each buffer it limits, and overall as the worst of them, `exhausted`
 * before `tolerating` before `available`.
 *
 * Every event held counts, seen or not, and every state kept, of executions
 * running or finished. Leave out a buffer you do not limit. An outbox that
 * limits nothing answers `available` with no buffers.
 *
 * @example
 * ```typescript
 * const capacity: ArvoOutboxCapacity = {
 *   status: 'tolerating',
 *   buffers: { events: { status: 'tolerating', held, size, limit } },
 * };
 * ```
 */
export type ArvoOutboxCapacity = {
  /** The worst status of every buffer, or `available` where none is limited. */
  readonly status: ArvoOutboxCapacityStatus;
  /** Each buffer the outbox limits. */
  readonly buffers: {
    /** Every event held, seen or not. */
    readonly events?: ArvoOutboxBufferCapacity;
    /** Every state kept, of executions running or finished. */
    readonly states?: ArvoOutboxBufferCapacity;
  };
};
