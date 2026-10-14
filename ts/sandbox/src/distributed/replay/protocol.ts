import type { JSONObject } from 'arvo-core';

/**
 * What a tape of one run says.
 *
 * A transcript is read back out of the database rather than collected as
 * a run goes, which is the whole point of it: anything a mechanism held
 * in memory is something a replay would be comparing against itself. If
 * a run cannot be described from what was committed, the record was not
 * the memory.
 */

/** One delivery, as the database remembers it. */
export type TranscriptStep = {
  /** The execution the delivery concerned. */
  readonly executionId: string;
  /** Which revision it wrote. */
  readonly casVersion: number;
  /**
   * The event that was delivered, in the event's own format.
   *
   * Read off the record it produced, every record holding the event
   * that caused it. So even the event that entered the lattice from
   * outside is recovered from the database rather than remembered.
   */
  readonly delivered: string;
  /**
   * The record as the delivery read it, or `null` where there was none
   * to read. The revision before this one.
   */
  readonly recordAsRead: JSONObject | null;
  /** The record this delivery committed. */
  readonly committed: JSONObject;
  /** Every event committed with it, in the event's own format. */
  readonly emitted: readonly string[];
};

/** One run, as the database remembers it. */
export type Transcript = {
  /** The workflow this is a tape of. */
  readonly subject: string;
  /** Every delivery that committed, oldest first. */
  readonly steps: readonly TranscriptStep[];
};

/** What one delivery did, for the loop to carry. */
export type DeliveryReport = {
  /**
   * `produced` ran the handler and committed. `recovered` found the work
   * already done and hands back what was committed then. `nothing`
   * found nothing to do at all.
   */
  readonly outcome: 'produced' | 'recovered' | 'nothing';
  /** The execution concerned, where anything said which. */
  readonly executionId: string | null;
  /** Where that execution rests, where a record was written. */
  readonly lifecycle: string | null;
  /** Everything committed, for the loop to sort. */
  readonly emitted: readonly string[];
  /** Why, where the outcome needs a reason. */
  readonly note: string | null;
};

/** How a run ended. */
export type RunOutcome = {
  /**
   * `answered` produced events for the caller. `waiting_on_outside` is
   * holding events only something outside the lattice may answer.
   * `nothing` produced neither.
   */
  readonly kind: 'answered' | 'waiting_on_outside' | 'nothing';
  /** The events of whichever of those it is, in the event's own format. */
  readonly events: readonly string[];
  /** How many deliveries were made. */
  readonly deliveries: number;
};
