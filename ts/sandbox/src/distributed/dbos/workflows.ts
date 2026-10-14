import { DBOS } from '@dbos-inc/dbos-sdk';
import { ArvoEventSerializer } from 'arvo-core';
import { handlerFor } from '../shared/routing.js';
import {
  ANSWER_TOPIC,
  type AnswerFromOutside,
  type RunOutcome,
  type RunParam,
} from './protocol.js';
import type { ParkedForAPerson, Steps } from './steps.js';

/**
 * The loop, as a DBOS workflow.
 *
 * One queue of work and two accumulators. It routes on `to` and nothing
 * else, and it makes no decision about an execution: not whether an
 * event opens one, not which one it concerns, not what a record should
 * say. Every one of those is the handler's, reached through a step.
 *
 * Durable because DBOS writes each step's result to its system database.
 * A worker that dies mid-run is replaced by one that replays this
 * function, is handed every result the steps already produced, and
 * carries on from the first delivery that had not been made.
 *
 * ## Where this differs from the Temporal adapter
 *
 * It can see the handlers. Temporal bundles workflow code for an isolate
 * with no Node built-ins, so its loop cannot import anything that
 * reaches the handler map and has to be told, as data, whether an
 * address is implemented. DBOS runs a workflow as an ordinary function
 * in the worker process, so the same question is a map lookup here.
 *
 * What that costs is a rule rather than a check: everything this
 * function does outside a step must be deterministic, and nothing stops
 * it from not being. `handlerFor` is a lookup in a frozen map, which is
 * safe; a clock or a random value would not be, and DBOS would only find
 * out on a replay.
 */

/** The format an event crosses a boundary in. */
const WIRE = new ArvoEventSerializer({ type: 'arvoevent' });

/** How much of the work this loop takes on at once. */
const AT_ONCE = 16;

/** What the workflow reaches, every one of them a registered step. */
export type WorkflowScope = {
  /** One delivery per handler, by that handler's own contract type. */
  readonly steps: Steps;
  /** Leaves an event nothing will carry further where a person finds it. */
  readonly park: (payload: string, why: ParkedForAPerson) => Promise<void>;
};

/**
 * One run: an event entering the lattice, and everything it leads to.
 *
 * @param scope - The steps this worker registered, and where an event
 * nothing will carry is left.
 * @param param - The event entering, and where this run answers.
 * @returns What the run came to, and how many deliveries it took.
 */
const arvoRun = async (
  scope: WorkflowScope,
  param: RunParam,
): Promise<RunOutcome> => {
  const answersTo = param.answersTo;

  const work: string[] = [param.payload];
  const domained: string[] = [];
  const responses: string[] = [];
  let delivered = 0;

  while (work.length > 0) {
    const taking = work.splice(0, AT_ONCE);

    const reports = await Promise.all(
      taking.map(async (payload) => {
        const event = await WIRE.deserialize(payload);
        const deliverToHandler =
          event.to === null ? undefined : scope.steps[event.to];
        if (deliverToHandler === undefined) {
          throw new Error(
            `no handler named ${event.to} is registered on this worker`,
          );
        }
        return deliverToHandler(payload);
      }),
    );
    delivered += taking.length;

    for (const report of reports) {
      for (const payload of report.emitted) {
        const emitted = await WIRE.deserialize(payload);

        if (emitted.domain !== null) {
          domained.push(payload);
          continue;
        }
        if (emitted.to === answersTo) {
          responses.push(payload);
          continue;
        }
        // Whether a handler implements the address is the loop's to
        // settle, so an emission addressed nowhere fails the run here
        // rather than becoming a delivery that cannot be made.
        if (handlerFor(emitted.to) === null) {
          await scope.park(payload, 'addressed_outside');
          throw new Error(
            `${emitted.type} ${emitted.id} is addressed to ${emitted.to}, which is neither a handler in this lattice nor the caller this run answers to (${answersTo})`,
          );
        }
        work.push(payload);
      }
    }
  }

  // An event that left the lattice is held, not published: nothing
  // running may be given it, and the execution that asked rests at
  // `waiting` until something outside answers.
  for (const payload of domained) {
    await scope.park(payload, 'left_the_lattice');
  }

  if (responses.length > 0) {
    return { kind: 'answered', events: responses, deliveries: delivered };
  }
  if (domained.length > 0) {
    return {
      kind: 'waiting_on_outside',
      events: domained,
      deliveries: delivered,
    };
  }
  return { kind: 'nothing', events: [], deliveries: delivered };
};

/**
 * One run, and then whatever something outside the lattice sends back.
 *
 * The run itself is the loop above. Where it comes to rest holding
 * events only something outside may answer, this waits — durably, for as
 * long as it takes, because the thing being waited on is a decision
 * somebody makes rather than work a worker is doing. Each answer that
 * arrives re-enters the lattice as an ordinary delivery, and the loop
 * runs again on whatever that leads to.
 *
 * `DBOS.recv` is the awaited event §6.3 asks for. Temporal does the same
 * thing with a signal; neither is more faithful than the other, and the
 * execution rests at `waiting` under both.
 */
const arvoRunAwaitingOutside = async (
  scope: WorkflowScope,
  param: RunParam,
): Promise<RunOutcome> => {
  let outcome = await arvoRun(scope, param);
  let delivered = outcome.deliveries;

  while (outcome.kind === 'waiting_on_outside') {
    const answered = await DBOS.recv<AnswerFromOutside>(ANSWER_TOPIC);
    // Nothing answered. The run stays where it is rather than being
    // failed: an execution waiting on a person is not a broken run.
    if (answered === null) break;

    outcome = await arvoRun(scope, {
      payload: answered.payload,
      answersTo: param.answersTo,
    });
    delivered += outcome.deliveries;
  }

  return { ...outcome, deliveries: delivered };
};

/**
 * Both workflows, registered once per worker.
 *
 * Registered rather than decorated, because the handlers these reach are
 * built by a factory and a decorator would have to name a class that
 * does not exist. DBOS keys a workflow's durable record by its name, so
 * these names are as much an interface as a table's columns are.
 *
 * @param scope - The steps this worker registered, and where an event
 * nothing will carry is left.
 */
export const createWorkflows = (scope: WorkflowScope) => ({
  arvoRun: DBOS.registerWorkflow((param: RunParam) => arvoRun(scope, param), {
    name: 'arvoRun',
  }),
  arvoRunAwaitingOutside: DBOS.registerWorkflow(
    (param: RunParam) => arvoRunAwaitingOutside(scope, param),
    { name: 'arvoRunAwaitingOutside' },
  ),
});

/** What a caller sees of this mechanism's workflows. */
export type Workflows = ReturnType<typeof createWorkflows>;
