import { DBOS } from '@dbos-inc/dbos-sdk';
import type { Span, SpanContext } from '@opentelemetry/api';
import { type ArvoEvent, ArvoEventSerializer } from 'arvo-core';
import { checkSource, continuing } from '../shared/entering.js';
import { destinationFor } from '../shared/routing.js';
import { ANSWER_TOPIC, type RunOutcome } from './protocol.js';
import type { Workflows } from './workflows.js';

/**
 * The ways into this mechanism from outside it.
 *
 * Two, and they are the same two Temporal has: start a run, and answer
 * something a run is waiting on. What differs is only how each is
 * carried — a DBOS workflow and a message to it, rather than a Temporal
 * workflow and a signal.
 */

/** The format an event crosses the boundary in. */
const WIRE = new ArvoEventSerializer({ type: 'arvoevent' });

/** What a run's workflow is called, which is also how it is answered. */
export const runIdFor = (event: ArvoEvent): string => `run-${event.id}`;

/**
 * Starts a run and waits for it to finish.
 *
 * The workflow identifier is the entering event's own id, which ADR-001
 * makes unique. So the same event sent twice is one run rather than two:
 * DBOS admits the identifier once, and the second caller is handed the
 * first run's outcome.
 *
 * @param workflows - What this worker registered.
 * @param event - The event entering the lattice. Its `source` is where
 * the run answers, and must not be a handler's contract type.
 * @param span - What the run belongs to. Without one the run is a trace
 * of its own, which is right for something nothing else caused and wrong
 * for everything else.
 * @returns What the run came to.
 * @throws Where the source names a handler, or where nothing here
 * implements what the event is addressed to.
 */
export const startRun = async (
  workflows: Workflows,
  event: ArvoEvent,
  span?: Span | SpanContext,
): Promise<RunOutcome> => {
  checkSource(event.source);

  const entering = continuing(event, span);
  if (destinationFor(entering).kind !== 'handled') {
    throw new Error(
      `${event.type} ${event.id} is addressed to ${event.to}, which no handler in this lattice implements, so there is no run to start`,
    );
  }

  const started = await DBOS.startWorkflow(workflows.arvoRunAwaitingOutside, {
    workflowID: runIdFor(entering),
  })({
    payload: await WIRE.serialize(entering),
    answersTo: entering.source,
  });

  return started.getResult();
};

/**
 * Hands a run the answer to something only something outside the lattice
 * could give it.
 *
 * Sent to the run rather than to the execution that asked: the execution
 * is a record, and a record is not something a message can be delivered
 * to. The run reads it and delivers it as an ordinary event, which is
 * what makes the gate judge it exactly as it judges any other answer —
 * an answer naming nothing it asked for is refused.
 *
 * @param runId - The run waiting, as {@link runIdFor} names it.
 * @param answer - The answer, built from the request it answers.
 */
export const answerFromOutside = async (
  runId: string,
  answer: ArvoEvent,
): Promise<void> => {
  await DBOS.send(
    runId,
    { payload: await WIRE.serialize(answer) },
    ANSWER_TOPIC,
    // The answer's own id: sending it twice is one message, so a desk
    // that retried its answer has not answered twice.
    answer.id,
  );
};
