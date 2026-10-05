import type { JSONObject } from 'arvo-core';

/**
 * What the workflows and activities of this mechanism pass between
 * themselves.
 *
 * Plain shapes, named here because workflow code is bundled for an
 * isolate and may not import the handlers — so the one fact it cannot
 * work out for itself, whether a handler exists for an address, is
 * carried across as data.
 */

/** One event a delivery produced, with the one fact the loop cannot see. */
export type EmittedEvent = {
  readonly eventId: string;
  readonly eventType: string;
  /** Where it is addressed. */
  readonly addressedTo: string | null;
  /** Its domain, or `null` where it has none. */
  readonly domain: string | null;
  /** Whether a handler in this lattice implements what it is addressed to. */
  readonly handled: boolean;
  readonly payload: string;
};

/** What one delivery did. */
export type DeliveryReport = {
  /**
   * `produced` ran the handler and committed. `recovered` found the work
   * already done and is handing back what was committed then.
   * `nothing` found nothing to do at all.
   */
  readonly outcome: 'produced' | 'recovered' | 'nothing';
  /** The execution concerned, where anything said which. */
  readonly executionId: string | null;
  /** Where that execution rests, where a record was read or written. */
  readonly lifecycle: string | null;
  /** Everything the delivery emitted, committed and ready to be sorted. */
  readonly emitted: readonly EmittedEvent[];
  /** Why, where the outcome needs a reason. */
  readonly note: string | null;
};

/** One record and the events produced with it, to be kept together. */
export type CommitRequest = {
  /** The event this delivery was of, so a repeat can find what it committed. */
  readonly triggeringEventId: string;
  /** The record exactly as the handler wrote it. */
  readonly record: JSONObject;
  /** Every event committed with it. */
  readonly events: readonly EmittedEvent[];
};

/** Why a commit was refused. */
export type CommitRefusal =
  /** Another writer reached this revision first. */
  | 'revision_taken'
  /** This revision does not follow the one before it. */
  | 'revision_out_of_sequence';

/** What one commit did. */
export type CommitOutcome =
  | { readonly committed: true; readonly casVersion: number }
  | {
      readonly committed: false;
      readonly because: CommitRefusal;
      /**
       * What was committed for this triggering event, where this is a
       * repeat of a delivery that already succeeded.
       *
       * Publishing these publishes what was committed, rather than
       * asking an executor to produce something equivalent again.
       */
      readonly alreadyCommitted: readonly EmittedEvent[];
    };

/** What one run's workflow is started with. */
export type RunParam = {
  /** The event entering the lattice, in the event's own format. */
  readonly payload: string;
};

/** How a run ended. */
export type RunOutcome =
  /** It answered its caller. */
  | { readonly kind: 'answered'; readonly events: readonly EmittedEvent[] }
  /** It is waiting on something outside the lattice. */
  | {
      readonly kind: 'waiting_on_outside';
      readonly events: readonly EmittedEvent[];
    }
  /** It produced nothing for anybody. */
  | { readonly kind: 'nothing' };

/** What one record's workflow is started with. */
export type RecordParam = {
  /** The execution whose record it holds, as the handler identified it. */
  readonly executionId: string;
};
