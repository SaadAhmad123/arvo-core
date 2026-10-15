import {
  ARVO_CATEGORY_COMPLETE,
  type ArvoEvent,
  createArvoEventFactory,
} from 'arvo-core';
import { manualReviewContract } from '../handler/com_manual_review/contract.js';

/**
 * How something outside the lattice answers a request that left it.
 *
 * A domained request is one no handler may be given, so nothing running
 * will ever answer it: the execution that asked rests at `waiting` until
 * a person, or something acting for one, decides. This is the shape that
 * decision arrives in.
 *
 * The answer is built from the request rather than assembled from
 * scratch, because an answer has to name what it answers. The execution
 * that asked, the workflow it belongs to, and the request's own id all
 * come off the request — and the last of those is what the asking
 * execution matches against the collection it is waiting on. An answer
 * that named nothing would be refused as an answer to a question nobody
 * asked, which is the gate working.
 *
 * Something outside the lattice is held to exactly the same rules as a
 * handler, and finding that out is part of the point. An answer missing
 * the id of what it answers is refused, and the execution waiting for it
 * is given up on rather than left waiting for ever — so a person
 * answering through a desk that got this wrong would fail the order
 * rather than merely failing to help it.
 */

/**
 * A factory per version of the review contract, keyed by what a request
 * carries.
 *
 * Keyed by `dataschema` rather than by a version parsed out of it, so
 * answering at a version the contract never declared is impossible
 * rather than merely unlikely.
 */
const REVIEW_FACTORIES = new Map(
  Object.values(manualReviewContract.versions).map((version) => [
    version.dataschema as string,
    createArvoEventFactory(version),
  ]),
);

/** What a decision about one review says. */
export type ReviewDecision = {
  readonly approved: boolean;
  /** Who decided, which is the whole point of the work having left. */
  readonly by: string;
};

/**
 * The event that answers one review request.
 *
 * @param request - The request that left the lattice, as it was
 * committed.
 * @param decision - What was decided, and by whom.
 * @returns The answer, addressed to the execution that asked.
 */
export const decisionFor = (
  request: ArvoEvent,
  decision: ReviewDecision,
): ArvoEvent => {
  const factory = REVIEW_FACTORIES.get(request.dataschema);
  if (factory === undefined) {
    throw new Error(
      `${request.dataschema} is not a version of the review contract, so there is nothing to answer it with`,
    );
  }

  return factory.createOutput({
    type: 'evt_review_decided',
    data: decision,
    // Whoever is acting for the person, which is not a handler and is
    // not pretending to be one.
    source: 'com.outside.review_desk',
    subject: request.subject,
    // Where the answer goes: the handler that asked, which the request
    // named as its own source.
    to: request.source,
    // Which execution is waiting, carried on the request because an
    // answer has to be routable without reading a record.
    executionid: request.executionid,
    // What is being answered, twice over and for two reasons. `initid`
    // names the request that opened the execution being answered, which
    // is what the asking execution matches against the collection it is
    // waiting on. `parentid` names the event this one was caused by,
    // which here is the same event.
    initid: request.id,
    parentid: request.id,
    depth: request.depth,
    // Stated rather than left absent. The receiving handler resolves
    // this event's role from its contract and refuses one whose sender
    // claimed a different role, so saying so is how a desk outside the
    // lattice is held to the same rule as a handler inside it.
    category: ARVO_CATEGORY_COMPLETE,
    traceparent: request.traceparent ?? undefined,
    tracestate: request.tracestate ?? undefined,
  });
};
