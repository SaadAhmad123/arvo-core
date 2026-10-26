import type { JSONObject } from '../../types.js';
import type { ArvoOutboxEventRecord } from './event-record.js';

/**
 * Everything one commit of a state and its events writes, flat.
 *
 * Every value your outbox keys, compares or indexes by is a field here.
 * **Never open `state` to find any of them**: it is a blob to the outbox,
 * stored and returned as the same JSON value.
 *
 * `casVersion` is the revision the state claims to be. Compare it, never
 * set it: the revision that marks an execution's first state is committed
 * only where nothing is stored for the execution, and every other revision
 * only where it follows the stored one by exactly one. See
 * `docs/adr/007-execution-record.md` and `docs/adr/019-outbox.md`.
 *
 * @example
 * ```typescript
 * const commit: ArvoOutboxStateCommit = {
 *   executionId,
 *   casVersion,
 *   subject,
 *   source,
 *   version,
 *   lifecycle,
 *   state,
 *   events: records,
 * };
 * ```
 */
export type ArvoOutboxStateCommit = {
  /** The execution, and with `casVersion` the state's key. */
  readonly executionId: string;
  /** The revision this state is, and with `executionId` its key. */
  readonly casVersion: number;
  /** The workflow, for indexing. */
  readonly subject: string;
  /** The handler the execution belongs to, for indexing. */
  readonly source: string;
  /** The contract version that owns the execution, for indexing. */
  readonly version: string;
  /** Where the execution rests, for indexing. */
  readonly lifecycle: string;
  /** The state itself. Store it whole; never read it. */
  readonly state: JSONObject;
  /** The events produced with it, committed in the same unit. */
  readonly events: readonly ArvoOutboxEventRecord[];
};

/**
 * Everything one commit of events with no state writes.
 *
 * Nothing is compared, so nothing is refused. Each record's `casVersion` is
 * `null`.
 *
 * @example
 * ```typescript
 * const commit: ArvoOutboxEventsCommit = { events: records };
 * ```
 */
export type ArvoOutboxEventsCommit = Pick<ArvoOutboxStateCommit, 'events'>;

/**
 * Why a commit was refused. Losing a race is ordinary, so a refusal is
 * returned, never thrown.
 *
 * - `state_exists` — the commit claimed the first revision, and a state is
 *   already stored for the execution.
 * - `revision_stale` — the commit's revision does not follow the stored one
 *   by exactly one.
 *
 * @example
 * ```typescript
 * const refusal: ArvoOutboxRefusal = 'revision_stale';
 * ```
 */
export type ArvoOutboxRefusal = 'state_exists' | 'revision_stale';

/**
 * What a commit of a state and its events came to: committed, or refused
 * and why. A refused commit has written nothing.
 *
 * @example
 * ```typescript
 * const outcome: ArvoOutboxCommitOutcome = { committed: false, refusal: 'state_exists' };
 * if (!outcome.committed) outcome.refusal;
 * ```
 */
export type ArvoOutboxCommitOutcome =
  | { readonly committed: true }
  | { readonly committed: false; readonly refusal: ArvoOutboxRefusal };
