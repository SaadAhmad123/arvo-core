import type { Attributes } from '@opentelemetry/api';
import type { VersionedArvoContract } from '../../ArvoContract/versioned/index.js';
import type { ArvoExecutionContextTelemetry } from '../context/telemetry/index.js';
import type { ArvoEntryKind } from '../context/types.js';
import type { ArvoExecutionState } from '../state/index.js';
import type { ArvoExecutionLifecycle } from '../state/types.js';

/**
 * Every stage one execution can reach, in the order they would be.
 *
 * Not one sequence: an execution that was answered partway stops at
 * `collection_partial`, and an entry into the executor ends at exactly one
 * of the three `executor_` stages. Which stages a span carries is
 * therefore how far the execution got, which is what tells an execution
 * refused on the way in from one refused on what it returned — and what
 * separates time inside the executor from time in the protocol around it.
 */
export const ARVO_EXECUTION_STAGES = Object.freeze([
  'record_resolved',
  'entry_judged',
  'dependencies_resolved',
  'collection_partial',
  'executor_entered',
  'executor_returned',
  'executor_raised',
  'executor_outran',
  'returns_judged',
  'record_written',
] as const);

/** One stage of an execution. */
export type ArvoExecutionStage = (typeof ARVO_EXECUTION_STAGES)[number];

/** How an execution ended, as a closed set a counter can carry. */
export type ArvoExecutionOutcome = 'produced' | 'discarded';

/** What identifies the version an execution ran, on every signal it writes. */
const versionAttributes = (self: VersionedArvoContract): Attributes => ({
  'contract.type': self.type,
  'contract.version': self.version,
});

/**
 * Puts on the span the identifiers a reader needs to find this execution.
 *
 * Set once, as early as the record allows, so that an execution refused a
 * moment later is still findable by the workflow it belonged to.
 *
 * @param telemetry - Where this execution records.
 * @param param - The record, and how the execution arrived.
 */
export const describeExecution = (
  telemetry: ArvoExecutionContextTelemetry,
  param: {
    state: ArvoExecutionState;
    entry: ArvoEntryKind;
    attempt: number;
  },
): void => {
  telemetry.setAttributes({
    subject: param.state.subject,
    'execution.id': param.state.executionId,
    'contract.type': param.state.source,
    'contract.version': param.state.version,
    entry: param.entry,
    attempt: param.attempt,
    depth: param.state.depth,
    'event.id': param.state.triggeringEvent.id,
    'event.type': param.state.triggeringEvent.type,
  });
};

/**
 * Marks a stage this execution reached on its span.
 *
 * @param telemetry - Where this execution records.
 * @param stage - The stage reached.
 * @param attributes - Whatever is worth knowing about it.
 */
export const markStage = (
  telemetry: ArvoExecutionContextTelemetry,
  stage: ArvoExecutionStage,
  attributes?: Attributes,
): void => {
  telemetry.addEvent(`stage.${stage}`, attributes);
};

/**
 * Records how long the executor itself ran.
 *
 * Kept apart from the execution as a whole so that slow business code and
 * a slow protocol around it are two different charts.
 *
 * @param telemetry - Where this execution records.
 * @param self - The version of the contract whose executor ran.
 * @param ms - How long the executor ran.
 */
export const markExecutorRan = (
  telemetry: ArvoExecutionContextTelemetry,
  self: VersionedArvoContract,
  ms: number,
): void => {
  telemetry.metric.record('executor.duration', ms, versionAttributes(self));
};

/**
 * Records what an execution came to, across all three signals.
 *
 * On the span, for whoever has the trace open. On a counter, so outcomes
 * can be charted. And as a log, which is the one signal that survives a
 * sampling decision.
 *
 * A fault is not recorded here: it is written where it is built, before it
 * is raised, because a fault writes no record.
 *
 * @param telemetry - Where this execution records.
 * @param param - What it came to.
 */
export const markOutcome = (
  telemetry: ArvoExecutionContextTelemetry,
  param: {
    outcome: ArvoExecutionOutcome;
    self: VersionedArvoContract;
    emitted?: number;
    lifecycle?: ArvoExecutionLifecycle;
  },
): void => {
  const lifecycle = param.lifecycle ?? 'none';

  telemetry.setAttributes({
    outcome: param.outcome,
    lifecycle,
    emitted: param.emitted ?? 0,
  });
  telemetry.setSpanOk();

  telemetry.metric.count('executions', {
    outcome: param.outcome,
    lifecycle,
    ...versionAttributes(param.self),
  });

  telemetry.logger.info(
    `this execution ${param.outcome} and rests at ${lifecycle}`,
    { emitted: param.emitted ?? 0 },
  );
};
