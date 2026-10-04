import type { Attributes } from '@opentelemetry/api';
import type { ArvoEvent } from '../ArvoEvent/index.js';
import type { ArvoExecutionContextTelemetry } from './context/telemetry/index.js';
import type { ArvoEntryKind } from './context/types.js';

/**
 * Every check an arriving event passes before a version is given it, in
 * the order it passes them.
 *
 * Not one sequence: an event opening an execution has no record to
 * hydrate and no stored version to confirm. Which of these a span carries
 * is therefore how far the event got before it was refused, which is what
 * separates an event nothing could place from one placed and then found
 * to name an execution nothing can resume.
 */
export const ARVO_ENTRY_STAGES = Object.freeze([
  'event_resolved',
  'category_agreed',
  'record_fetched',
  'record_hydrated',
  'version_resolved',
] as const);

/** One check an arriving event passed. */
export type ArvoEntryStage = (typeof ARVO_ENTRY_STAGES)[number];

/**
 * Puts on the span what a reader needs to find this execution, as early
 * as the event allows.
 *
 * Set before the record is read, so an event refused for having no
 * execution to resume is still findable by the workflow it named.
 *
 * @param telemetry - Where this execution records.
 * @param param - What the event and the resolution say about it.
 */
export const describeEntry = (
  telemetry: ArvoExecutionContextTelemetry,
  param: {
    event: ArvoEvent;
    entry: ArvoEntryKind;
    executionId: string;
    attempt: number;
  },
): void => {
  telemetry.setAttributes({
    subject: param.event.subject,
    'execution.id': param.executionId,
    entry: param.entry,
    attempt: param.attempt,
    depth: param.event.depth,
    'event.id': param.event.id,
    'event.type': param.event.type,
    'event.dataschema': param.event.dataschema,
  });
};

/**
 * Marks a check an arriving event passed, on the span it is recorded on.
 *
 * @param telemetry - Where this execution records.
 * @param stage - The check it passed.
 * @param attributes - Whatever is worth knowing about it.
 */
export const markEntryStage = (
  telemetry: ArvoExecutionContextTelemetry,
  stage: ArvoEntryStage,
  attributes?: Attributes,
): void => {
  telemetry.addEvent(`stage.${stage}`, attributes);
};
