import { err, ok } from 'neverthrow';
import * as z from 'zod/v4/core';
import type { VersionedArvoContract } from '../../ArvoContract/versioned/index.js';
import { ArvoEvent } from '../../ArvoEvent/index.js';
import { fromNeverthrow } from '../../result.js';
import type { AsyncResult, JSONObject } from '../../types.js';
import { resolveEmissionTarget } from '../emission/target.js';
import type { ArvoExecutionState } from '../state/index.js';
import { ArvoExecutionStateSerializer } from '../state/serializer/index.js';
import { mutateState } from '../state/utils.js';
import type { ArvoExecutorEmission } from '../types/execute.js';
import type { ArvoServiceMap } from '../types/services.js';
import type { ArvoGateRefusal } from './types.js';

/**
 * The batch an executor meant, or `null` where what it handed back was
 * never a batch at all.
 *
 * One event is a batch of one, a list is the batch, and nothing is an
 * empty batch. Anything else — a value that is not an event, or a list
 * holding one — is the executor code being broken rather than the work
 * failing.
 */
export const collectBatch = (
  returned: ArvoExecutorEmission,
): ArvoEvent[] | null => {
  if (returned === undefined || returned === null) return [];
  const batch = Array.isArray(returned) ? returned : [returned];
  return batch.every((event) => event instanceof ArvoEvent) ? batch : null;
};

/**
 * Why a batch may not leave the handler, or `null` where it may.
 *
 * Judged whole and refused whole: a batch is one decision by one
 * executor, and emitting part of it would leave an execution in a state
 * no lifecycle can describe. Every event at fault is reported, not merely
 * the first.
 */
export const refuseBatch = <TSelf extends VersionedArvoContract>(
  self: TSelf,
  services: ArvoServiceMap,
  maxDepth: number,
  batch: readonly ArvoEvent[],
): ArvoGateRefusal | null => {
  const violations: string[] = [];
  let faultKind: ArvoGateRefusal['faultKind'] = 'emission_not_permitted';
  let completions = 0;

  for (const event of batch) {
    const target = resolveEmissionTarget(self, services, event.type);
    if (target === null) {
      violations.push(
        `${event.type}: names neither a declared service's input nor one of this version's outputs`,
      );
      continue;
    }

    if (target.role === 'completion') {
      completions += 1;
      if (completions > 1) {
        violations.push(
          `${event.type}: is a second answer to the caller, who awaits exactly one`,
        );
        continue;
      }
    }

    if (event.depth >= maxDepth) {
      faultKind = 'max_depth_event_requested';
      violations.push(
        `${event.type}: would sit at ${event.depth}, and this version allows below ${maxDepth}`,
      );
      continue;
    }

    const schema =
      target.role === 'service'
        ? target.contract.input
        : target.contract.outputs[event.type];
    const checked = z.safeParse(schema as z.$ZodType, event.data);
    if (!checked.success) {
      faultKind = 'emission_schema_rejected';
      violations.push(
        `${event.type}: ${checked.error.issues
          .map(
            (issue) =>
              `data.${issue.path.join('.') || '(root)'} ${issue.message}`,
          )
          .join('; ')}`,
      );
    }
  }

  if (violations.length === 0) return null;
  return {
    faultKind,
    message: `this batch may not leave the handler: ${violations.length} of its ${batch.length} events is at fault`,
    violations,
  };
};

/**
 * The record this execution stands at, once its batch is in.
 *
 * Where it rests depends only on what the batch carries: an answer to the
 * caller finishes it, requests to services leave it waiting, and nothing
 * leaves it waiting on whatever was already outstanding — or idle, where
 * nothing was. A version with no output and no service to call has
 * nothing it could have returned, so nothing finishes it.
 *
 * An executor that ended the execution deliberately is honoured whatever
 * the batch holds. What the execution is waiting for is rebuilt from the
 * batch rather than merged into, so it always describes exactly this
 * round. The record given is not changed.
 */
export const settleRecord = <
  TState extends ArvoExecutionState,
  TSelf extends VersionedArvoContract,
>(
  self: TSelf,
  services: ArvoServiceMap,
  state: TState,
  batch: readonly ArvoEvent[],
): TState => {
  const requests: ArvoEvent[] = [];
  let answered = false;

  for (const event of batch) {
    const target = resolveEmissionTarget(self, services, event.type);
    if (target?.role === 'service') requests.push(event);
    if (target?.role === 'completion') answered = true;
  }

  const awaiting =
    requests.length > 0
      ? new Map(requests.map((event) => [event.id, null]))
      : state.inFlightEventMap;

  const isSink =
    Object.keys(self.outputs).length === 0 &&
    Object.keys(services).length === 0;
  const outstanding = [...awaiting.values()].some((answer) => answer === null);

  const lifecycle =
    state.lifecycle === 'cancelled'
      ? 'cancelled'
      : answered || (batch.length === 0 && isSink)
        ? 'success'
        : requests.length > 0 || outstanding
          ? 'waiting'
          : 'idle';

  return mutateState(state, {
    lifecycle,
    inFlightEventMap: awaiting,
    eventIds: [
      ...state.eventIds,
      ...batch.map((event) => ({
        id: event.id,
        direction: 'emitted' as const,
      })),
    ],
  });
};

/**
 * The record to commit, written out, or why this execution has none.
 *
 * The revision is advanced here and nowhere else. Data must not be empty:
 * an execution remembering nothing in particular writes `{}`, and one that
 * remembered nothing at all did not do the work. Data that will not
 * survive a JSON round trip is the executor's own doing, which a declared
 * schema cannot prevent.
 */
export const recordToCommit = async <TDataSchema extends z.$ZodObject>(
  dataSchema: TDataSchema,
  state: ArvoExecutionState<TDataSchema>,
): AsyncResult<JSONObject, ArvoGateRefusal> => {
  if (state.data === null) {
    return fromNeverthrow(
      err({
        faultKind: 'state_schema_rejected',
        message:
          'this execution finished having remembered nothing, and a record is only written for one that did something',
        violations: [],
      } as const),
    );
  }

  const written = await new ArvoExecutionStateSerializer(
    dataSchema,
  ).trySerialize(mutateState(state, { casVersion: state.casVersion + 1 }));

  if (!written.ok) {
    return fromNeverthrow(
      err({
        faultKind: 'state_not_serializable',
        message:
          'this execution finished holding something that cannot be written out',
        violations: [],
        cause: written.error.message,
      } as const),
    );
  }

  return fromNeverthrow(ok(JSON.parse(written.value) as JSONObject));
};
