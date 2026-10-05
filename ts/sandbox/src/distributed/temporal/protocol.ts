import type { JSONObject } from 'arvo-core';

/**
 * What this mechanism's workflows and activities pass between
 * themselves.
 *
 * Plain shapes, named apart from both, because workflow code is bundled
 * for an isolate and cannot import the handlers. The one fact the loop
 * cannot work out for itself — whether a handler exists for an address —
 * is carried across as data.
 */

/** One event a delivery emitted. */
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
   * already done and is handing back what was committed then. `nothing`
   * found nothing to do at all.
   */
  readonly outcome: 'produced' | 'recovered' | 'nothing';
  /** The execution concerned, where anything said which. */
  readonly executionId: string | null;
  /** Where that execution rests, where a record was written. */
  readonly lifecycle: string | null;
  /** Everything committed, ready for the loop to sort. */
  readonly emitted: readonly EmittedEvent[];
  /** Why, where the outcome needs a reason. */
  readonly note: string | null;
};

/** One record and the events produced with it, kept as one thing. */
export type Revision = {
  /** The event this delivery was of, so a repeat can find what it committed. */
  readonly triggeringEventId: string;
  /** The record exactly as the handler wrote it. */
  readonly state: JSONObject;
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
       * What was committed for this delivery's triggering event, where a
       * revision for it exists — this delivery having already succeeded
       * once. Publishing these publishes what was committed rather than
       * producing it again.
       *
       * `null` where no revision names this triggering event. The record
       * moved on under a different delivery, and this one has not been
       * carried out at all: it has to be made again against the record
       * as it now stands.
       */
      readonly alreadyCommitted: readonly EmittedEvent[] | null;
    };

/** What one run's workflow is started with. */
export type RunParam = {
  /** The event entering the lattice, in the event's own format. */
  readonly payload: string;
  /**
   * Where this run answers, which is that event's `source`.
   *
   * Read by whoever sends the event in, because that sender is the one
   * obliged to make it something no handler is named by.
   */
  readonly answersTo: string;
};

/** How a run ended. */
export type RunOutcome = {
  /**
   * `answered` produced events for the caller. `waiting_on_outside` is
   * holding events only something outside the lattice may answer.
   * `nothing` produced neither.
   */
  readonly kind: 'answered' | 'waiting_on_outside' | 'nothing';
  /** The events of whichever of those it is, and empty for `nothing`. */
  readonly events: readonly EmittedEvent[];
  /** How many deliveries the loop made. */
  readonly deliveries: number;
};

/** What one record's workflow is started with. */
export type RecordParam = {
  /** The execution whose record it holds, as the handler identified it. */
  readonly executionId: string;
};
