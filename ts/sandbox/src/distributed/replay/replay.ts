import { ArvoEventSerializer } from 'arvo-core';
import { type DeliveryScope, deliverWithRetries } from './delivery.js';
import type { DeliveryReport, Transcript } from './protocol.js';

/**
 * A tape played back through a handler that knows nothing of the run
 * that made it.
 *
 * The order comes from the tape rather than from the loop, which is what
 * makes this a replay and not a second run: every event delivered is the
 * event the first run delivered, so nothing a handler emits this time
 * decides what it is given next. What is being tested is the handler
 * against the record, with the mechanism's routing taken out of it.
 *
 * Nothing of the first run may be alive when this starts — not its
 * records, not its outbox, and not the handlers' own data. A replay
 * reading what the run left behind is reading different inputs.
 *
 * Each delivery is given the record the tape says it read, rather than
 * whatever the replay has committed by then. That is not a convenience,
 * it is the only way the question can be asked: an execution waits on
 * the identifiers of the events it emitted, a handler mints those, and
 * the protocol never asked it to mint the same ones twice. A replay
 * chaining its own commits would therefore present a parent with an
 * answer to a request it had not sent — and the parent would be right
 * to refuse it. Reading from the tape and committing to the store asks
 * exactly what obligation 2 promises: that a handler given its record
 * and its event comes to the same place.
 */

/** The format an event crosses a boundary in. */
const WIRE = new ArvoEventSerializer({ type: 'arvoevent' });

/** What one replayed delivery came to. */
export type ReplayedStep = {
  /** The execution the tape said this delivery concerned. */
  readonly executionId: string;
  /** Which revision the tape said it wrote. */
  readonly casVersion: number;
  /** What the delivery did this time. */
  readonly report: DeliveryReport;
};

/**
 * Plays a transcript through, one delivery at a time.
 *
 * Deliveries are made one after another rather than together: the tape
 * is an order, and running it concurrently would be asking a different
 * question (§11 asks that one).
 *
 * @param scope - Where records go and where the handlers' data is.
 * @param tape - The run to play back.
 * @param order - Which steps to play and in what order, for a replay
 * that is deliberately not the first run's. Defaults to the tape's own
 * order.
 * @returns What each delivery came to, in the order they were made.
 */
export const replayTranscript = async (
  scope: DeliveryScope,
  tape: Transcript,
  order?: readonly number[],
): Promise<readonly ReplayedStep[]> => {
  const playing = order ?? tape.steps.map((_, position) => position);
  const played: ReplayedStep[] = [];

  for (const position of playing) {
    const step = tape.steps[position];
    if (step === undefined) {
      throw new Error(`the tape has no step at ${position}`);
    }

    played.push({
      executionId: step.executionId,
      casVersion: step.casVersion,
      // Retried as the run was: the attempt is an input a record does
      // not keep, so a handler that had to fail twice before it could
      // succeed has to be allowed to do that again.
      report: await deliverWithRetries(
        { ...scope, readRecord: () => Promise.resolve(step.recordAsRead) },
        await WIRE.deserialize(step.delivered),
      ),
    });
  }

  return played;
};
