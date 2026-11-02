import type { IArvoOutbox } from 'arvo-core';
import { LatencySamples } from './measure.js';

/**
 * An outbox that times every call it passes on, so a check measures each
 * operation where the driver calls it.
 */

/** The operations an outbox offers, by name. */
const OUTBOX_OPERATION_NAMES = Object.freeze([
  'readLatestState',
  'commitStateAndEvents',
  'commitEvents',
  'readCommittedEvents',
  'listUnseenEvents',
  'markEventsSeen',
  'capacity',
] as const);

/** Wraps an outbox, answering it and the samples each operation's calls left. */
export const timeOutbox = (outbox: IArvoOutbox) => {
  const samplesByOperation = new Map(
    OUTBOX_OPERATION_NAMES.map((operationName) => [
      operationName,
      new LatencySamples(),
    ]),
  );
  const timed = (operationName: (typeof OUTBOX_OPERATION_NAMES)[number]) => {
    const samples =
      samplesByOperation.get(operationName) ?? new LatencySamples();
    return <Answer>(call: () => Answer) => samples.time(call);
  };
  const timedOutbox: IArvoOutbox = {
    open: () => outbox.open(),
    close: () => outbox.close(),
    readLatestState: (executionId) =>
      timed('readLatestState')(() => outbox.readLatestState(executionId)),
    commitStateAndEvents: (param) =>
      timed('commitStateAndEvents')(() => outbox.commitStateAndEvents(param)),
    commitEvents: (param) =>
      timed('commitEvents')(() => outbox.commitEvents(param)),
    readCommittedEvents: (filter) =>
      timed('readCommittedEvents')(() => outbox.readCommittedEvents(filter)),
    listUnseenEvents: (param) =>
      timed('listUnseenEvents')(() => outbox.listUnseenEvents(param)),
    markEventsSeen: (eventIds) =>
      timed('markEventsSeen')(() => outbox.markEventsSeen(eventIds)),
    capacity: (request) => timed('capacity')(() => outbox.capacity(request)),
  };
  return {
    timedOutbox,
    /** Writes each operation's timings to the report. */
    report: (check: string): void => {
      for (const [operationName, samples] of samplesByOperation) {
        samples.report(check, operationName);
      }
    },
  };
};
