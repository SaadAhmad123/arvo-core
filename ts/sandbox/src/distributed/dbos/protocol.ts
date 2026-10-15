/**
 * What this mechanism's workflow and steps pass between themselves.
 *
 * Every one of these crosses a durability boundary: DBOS writes a step's
 * return value to its system database so that a replay returns it
 * instead of running the step again. So these are plain, serializable
 * shapes, and an event travels as the bytes it was committed as rather
 * than as an object something would have to rebuild.
 */

/** What one delivery did. */
export type DeliveryReport = {
  /**
   * `produced` ran the handler and committed. `recovered` found the work
   * already done and hands back what was committed then. `nothing` found
   * nothing to do at all.
   */
  readonly outcome: 'produced' | 'recovered' | 'nothing';
  /** The execution concerned, where anything said which. */
  readonly executionId: string | null;
  /** Where that execution rests, where a record was written. */
  readonly lifecycle: string | null;
  /** Everything committed, in the event's own format, for the loop to sort. */
  readonly emitted: readonly string[];
  /** Why, where the outcome needs a reason. */
  readonly note: string | null;
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
  /** The events of whichever of those it is, in the event's own format. */
  readonly events: readonly string[];
  /** How many deliveries the loop made. */
  readonly deliveries: number;
};

/** What something outside the lattice sends back in. */
export type AnswerFromOutside = {
  /** The answer, in the event's own format. */
  readonly payload: string;
};

/** The topic an answer from outside arrives on. */
export const ANSWER_TOPIC = 'arvo.answer';
