import { type ArvoEvent, ArvoEventSerializer } from 'arvo-core';
import { handlerFor } from '../shared/routing.js';
import { type DeliveryScope, deliverWithRetries } from './delivery.js';
import type { RunOutcome } from './protocol.js';

/**
 * One run, start to finish, in this process.
 *
 * The same loop the Temporal adapter's workflow runs: one queue of work
 * and two accumulators, routing on `to` and nothing else. It makes no
 * decision about an execution — not whether an event opens one, not
 * which one it concerns, not what a record should say.
 *
 * What it does not have is durability. Nothing here survives the
 * process, which is exactly what makes it the control: everything a run
 * comes to has to have come from the record store, there being nowhere
 * else for it to have come from.
 */

/** The format an event crosses a boundary in. */
const WIRE = new ArvoEventSerializer({ type: 'arvoevent' });

/** An emission is addressed somewhere this run cannot send it. */
export class UnroutableEmission extends Error {
  constructor(event: ArvoEvent, answersTo: string) {
    super(
      `${event.type} ${event.id} is addressed to ${event.to}, which is neither a handler in this lattice nor the caller this run answers to (${answersTo})`,
    );
    this.name = 'UnroutableEmission';
  }
}

/** How much this loop will take on at once. */
const AT_ONCE = 16;

/**
 * Runs one event, and everything it leads to, until there is no work
 * left.
 *
 * @param scope - Where records go and where the handlers' data is.
 * @param entering - The event entering the lattice. Its `source` is
 * where this run answers, so it must be something no handler is named
 * by — the sender's obligation, not this loop's.
 * @returns What the run came to, and how many deliveries it took.
 * @throws {UnroutableEmission} Where a handler emitted to an address
 * that is neither a handler here nor the caller.
 */
export const runOneWorkflow = async (
  scope: DeliveryScope,
  entering: ArvoEvent,
): Promise<RunOutcome> => {
  const answersTo = entering.source;

  const work: ArvoEvent[] = [entering];
  const domained: ArvoEvent[] = [];
  const responses: ArvoEvent[] = [];
  let delivered = 0;

  while (work.length > 0) {
    const taking = work.splice(0, AT_ONCE);
    const reports = await Promise.all(
      taking.map((event) => deliverWithRetries(scope, event)),
    );
    delivered += taking.length;

    for (const report of reports) {
      for (const payload of report.emitted) {
        const emitted = await WIRE.deserialize(payload);

        if (emitted.domain !== null) {
          domained.push(emitted);
          continue;
        }
        if (emitted.to === answersTo) {
          responses.push(emitted);
          continue;
        }
        // Whether a handler implements the address is the loop's to
        // settle, so an emission addressed nowhere fails the run here
        // rather than becoming a delivery that cannot be made.
        if (handlerFor(emitted.to) === null) {
          throw new UnroutableEmission(emitted, answersTo);
        }
        work.push(emitted);
      }
    }
  }

  const sent = async (events: readonly ArvoEvent[]) =>
    Promise.all(events.map((one) => WIRE.serialize(one)));

  if (responses.length > 0) {
    return {
      kind: 'answered',
      events: await sent(responses),
      deliveries: delivered,
    };
  }
  if (domained.length > 0) {
    return {
      kind: 'waiting_on_outside',
      events: await sent(domained),
      deliveries: delivered,
    };
  }
  return { kind: 'nothing', events: [], deliveries: delivered };
};
