import {
  condition,
  defineQuery,
  defineSignal,
  getExternalWorkflowHandle,
  log,
  ParentClosePolicy,
  proxyActivities,
  setHandler,
  startChild,
  workflowInfo,
} from '@temporalio/workflow';
import type { Activities, ExecutionReport } from './activities.js';
import { BOOKKEEPING_ACTIVITY, EXECUTION_ACTIVITY } from './retry.js';

/**
 * One execution of one handler, as a Temporal workflow.
 *
 * One workflow per execution, named by the execution's own identifier.
 * That is the whole of the design, and it is what makes obligation 5
 * hold for this mechanism: Temporal admits one workflow of a given id,
 * so one execution's record has one writer by construction. The
 * compare-and-swap counter in the record is then a consistency check
 * rather than the thing doing the work — and whether a redundant
 * guarantee is a cost or a defence is one of the questions this is here
 * to answer.
 *
 * What the workflow knows about Arvo is nothing. It takes an event in,
 * hands it to an activity, and does what the activity's report tells it:
 * start these executions, hand these answers to those executions, and
 * close if this one accepts nothing further. Every decision about what
 * an event means was made below it.
 *
 * It rests between deliveries. An execution waiting on five hundred
 * answers is a workflow awaiting five hundred signals, and an execution
 * waiting on a person is a workflow that waits as long as the person
 * does — which is what waiting is supposed to mean.
 */

/** An answer arriving for this execution, in the event's own format. */
export const answer = defineSignal<[string]>('arvo.answer');

/** What this execution is doing, for anybody looking at it from outside. */
export const progress = defineQuery<ExecutionProgress>('arvo.progress');

/** What an execution looks like while it is still going. */
export type ExecutionProgress = {
  /** How many deliveries this execution has carried out. */
  readonly executions: number;
  /** How many arrived and have not been carried out yet. */
  readonly waiting: number;
  /** Where the record rested last, or `null` before anything was committed. */
  readonly lifecycle: string | null;
};

/** What one execution's workflow is started with. */
export type ExecutionWorkflowParam = {
  /** The event that opens it, in the event's own format. */
  readonly triggering: string;
  /** What it implements, so a history says so without decoding an event. */
  readonly contractType: string;
};

/** What a finished execution's workflow answers with. */
export type ExecutionSummary = {
  readonly executionId: string;
  readonly contractType: string;
  /** How many deliveries it took to reach the end. */
  readonly executions: number;
  /** Where it came to rest. */
  readonly lifecycle: string | null;
  /** What the last delivery did. */
  readonly outcome: ExecutionReport['outcome'];
  /** What a person reading a history would want to know, where anything. */
  readonly note: string | null;
};

const { runOneExecution } = proxyActivities<Activities>(EXECUTION_ACTIVITY);
const { published, couldNotSend } =
  proxyActivities<Activities>(BOOKKEEPING_ACTIVITY);

/**
 * Sends everything one delivery committed, and says what was sent.
 *
 * All at once rather than one after another: a five-hundred-wide fan-out
 * that started its children in sequence would take five hundred round
 * trips to do what Temporal can be asked to do in one batch.
 *
 * Sent from the workflow, which is what makes the workflow the
 * publisher. Its decisions survive the worker that made them, so an
 * event dispatched here is dispatched exactly once however many times
 * the worker dies — and the recovery publisher is left with only what no
 * workflow got round to.
 */
const sendAll = async (report: ExecutionReport): Promise<void> => {
  const sent = await Promise.all(
    report.dispatch.map(async (one) => {
      if (one.kind === 'opens') {
        try {
          await startChild(arvoExecution, {
            workflowId: one.executionId,
            taskQueue: one.taskQueue,
            args: [{ triggering: one.payload, contractType: one.contractType }],
            // Nothing here owns anything there. An execution outlives
            // whatever asked for it, and a child cancelled because its
            // parent finished would be an execution abandoned by
            // Temporal rather than by Arvo.
            parentClosePolicy: ParentClosePolicy.ABANDON,
          });
          return one.eventId;
        } catch (raised) {
          // The execution already exists, which is what a redelivered
          // request looks like. Already open is the outcome asked for.
          if (
            raised instanceof Error &&
            raised.name === 'WorkflowExecutionAlreadyStartedError'
          ) {
            log.info('the execution asked for was already open', {
              executionId: one.executionId,
            });
            return one.eventId;
          }
          throw raised;
        }
      }

      try {
        await getExternalWorkflowHandle(one.executionId).signal(
          answer,
          one.payload,
        );
        return one.eventId;
      } catch (raised) {
        // Temporal retries a signal it thinks could succeed, so a
        // rejection here means the execution being answered is not
        // there to answer. An answer nobody can be given is filed
        // rather than dropped.
        await couldNotSend({
          payload: one.payload,
          executionId: one.executionId,
          message: `no execution ${one.executionId} to answer: ${String(raised)}`,
        });
        return one.eventId;
      }
    }),
  );

  await published(sent);
};

/**
 * Carries one execution for as long as it lasts.
 *
 * @param param - The event that opens it, and what it implements.
 * @returns What it did and where it came to rest.
 */
export async function arvoExecution(
  param: ExecutionWorkflowParam,
): Promise<ExecutionSummary> {
  const executionId = workflowInfo().workflowId;

  /** Deliveries that have arrived and not been carried out. */
  const arrived: string[] = [param.triggering];
  let executions = 0;
  let last: ExecutionReport | null = null;

  setHandler(answer, (payload: string) => {
    arrived.push(payload);
  });

  setHandler(progress, () => ({
    executions,
    waiting: arrived.length,
    lifecycle: last?.lifecycle ?? null,
  }));

  while (true) {
    const next = arrived.shift();

    if (next === undefined) {
      // Resting. Nothing is held open here: what this execution
      // remembers is in its record, and this workflow is only the thing
      // that will be told when an answer arrives.
      await condition(() => arrived.length > 0);
      continue;
    }

    const report = await runOneExecution(next);
    executions += 1;
    last = report;

    await sendAll(report);

    if (report.finished) {
      return {
        executionId,
        contractType: param.contractType,
        executions,
        lifecycle: report.lifecycle,
        outcome: report.outcome,
        note: report.note,
      };
    }
  }
}
