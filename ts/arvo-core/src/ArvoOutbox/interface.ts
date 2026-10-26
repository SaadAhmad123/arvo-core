import type { JSONObject, PromiseAble } from '../types.js';
import type {
  ArvoOutboxCommitOutcome,
  ArvoOutboxEventsCommit,
  ArvoOutboxStateCommit,
} from './types/commit.js';
import type { ArvoOutboxCommittedEventRecord } from './types/event-record.js';
import type {
  ArvoOutboxEventsFilter,
  ArvoOutboxUnseenEventsParam,
} from './types/read.js';

/**
 * Where each execution's state and every event committed with it are kept.
 *
 * Implement this against your own storage. A state and the events committed
 * with it land together or not at all; a stale write is refused, not
 * thrown; and every event is kept exactly as committed, so that after a
 * crash it is resent rather than produced again.
 *
 * Your outbox opens nothing it is given: neither the state nor an event's
 * payload. It stores, compares and finds by the plain fields beside them.
 * It sends nothing either — whatever runs your handlers lists what has not
 * been sent, sends it, and marks it seen.
 *
 * Every operation may answer directly or through a promise, and may throw
 * whatever your storage throws. You never build an Arvo error or result.
 *
 * Your outbox is opened before it is used and closed after. Opening an open
 * outbox, or closing a closed one, does nothing, and every operation throws
 * once it is closed. {@link ArvoOutboxLifecycle} keeps these rules for you.
 *
 * Run `describeArvoOutboxConformance` from `arvo-core/outbox/conformance`
 * against your outbox to check it meets every rule. See
 * `docs/adr/019-outbox.md`.
 *
 * @example
 * ```typescript
 * class PostgresOutbox implements IArvoOutbox {
 *   constructor(private readonly db: Pool) {}
 *
 *   async readLatestState(executionId: string) {
 *     const row = await this.db.oneOrNone(
 *       'select document from state where execution_id = $1 order by cas_version desc limit 1',
 *       [executionId],
 *     );
 *     return row?.document ?? null;
 *   }
 *
 *   async commitStateAndEvents(commit: ArvoOutboxStateCommit) {
 *     // in one transaction: refuse a stale revision, insert the state,
 *     // insert each event that is not already stored
 *   }
 *
 *   // commitEvents, readCommittedEvents, listUnseenEvents, markEventsSeen,
 *   // open and close
 * }
 * ```
 */
export interface IArvoOutbox {
  /**
   * The latest state of one execution, or `null` where none is stored.
   *
   * Read from storage on every call; never cache. Return the state with the
   * highest `casVersion`, as the same JSON value it was committed as.
   *
   * @param executionId - The execution to read.
   * @throws Anything your storage throws.
   */
  readLatestState(executionId: string): PromiseAble<JSONObject | null>;

  /**
   * Commits one state and the events produced with it, together or not at
   * all.
   *
   * Refuse with `state_exists` where `param.casVersion` claims the first
   * revision and a state is already stored, and with `revision_stale` where
   * it does not follow the stored revision by exactly one; a refused commit
   * writes nothing. Skip any event whose `id` is already stored, without
   * failing. Stamp every event with one `committedAt` from your own clock,
   * and store each as not yet seen.
   *
   * @param param - Everything the commit writes. See {@link ArvoOutboxStateCommit}.
   * @returns Whether it committed, or why it was refused.
   * @throws Anything your storage throws, where it could not do the work at all.
   */
  commitStateAndEvents(
    param: ArvoOutboxStateCommit,
  ): PromiseAble<ArvoOutboxCommitOutcome>;

  /**
   * Commits events with no state, together or not at all.
   *
   * Nothing is compared and nothing refused. Skip any event whose `id` is
   * already stored, without failing. Stamp every event with one
   * `committedAt` from your own clock, and store each as not yet seen.
   *
   * @param param - The events. See {@link ArvoOutboxEventsCommit}.
   * @throws Anything your storage throws.
   */
  commitEvents(param: ArvoOutboxEventsCommit): PromiseAble<void>;

  /**
   * The committed events matching every field of the filter, exactly as
   * committed, seen or not. Nothing where nothing matches.
   *
   * @param filter - Which events. See {@link ArvoOutboxEventsFilter}.
   * @throws Anything your storage throws.
   */
  readCommittedEvents(
    filter: ArvoOutboxEventsFilter,
  ): PromiseAble<readonly ArvoOutboxCommittedEventRecord[]>;

  /**
   * The events not yet seen, oldest `committedAt` first, and in the order
   * committed where two landed at the same time.
   *
   * Leave out anything that landed less than `param.olderThanMs` ago by
   * your own clock, and list no more than `param.atMost`. Where
   * `param.leaseMs` is given you may claim what you list for that long,
   * leaving it out of every other listing until the claim lapses or the
   * event is marked seen; you need not.
   *
   * @param param - How many, and how recent is too recent. See {@link ArvoOutboxUnseenEventsParam}.
   * @throws Anything your storage throws.
   */
  listUnseenEvents(
    param: ArvoOutboxUnseenEventsParam,
  ): PromiseAble<readonly ArvoOutboxCommittedEventRecord[]>;

  /**
   * Marks events seen, once a queue has accepted them.
   *
   * Change nothing else about them. An event already seen, or an `id` no
   * event carries, is left alone without failing.
   *
   * @param eventIds - The events a queue has accepted.
   * @throws Anything your storage throws.
   */
  markEventsSeen(eventIds: readonly string[]): PromiseAble<void>;

  /**
   * Opens your outbox: acquires what it needs, such as a connection, before
   * any operation is used. Opening it again does nothing.
   *
   * You may also answer operations before it is opened, as a pool that
   * connects on first use does, and may allow it to be opened again after it
   * is closed.
   *
   * @throws Anything your storage throws, where it cannot be opened.
   */
  open(): PromiseAble<void>;

  /**
   * Closes your outbox: releases what opening acquired. Closing it again does
   * nothing, and every operation throws once it is closed.
   *
   * @throws Anything your storage throws, where it cannot be released.
   */
  close(): PromiseAble<void>;
}
