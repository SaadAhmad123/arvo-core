import { ArvoOutboxDriver, type IArvoOutbox } from 'arvo-core';
import { describe, expect, it } from 'vitest';
import { buildEvent, buildState } from '../../../src/load/harness/builders.js';
import { recordMeasurement } from '../../../src/load/harness/results.js';
import type { LoadSubject } from '../../../src/load/harness/subjects.js';

/** A repeatable stream of numbers between zero and one. */
const seededRandom = (seed: number) => {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
};

/**
 * Wraps an outbox so that, by chance, a call throws, or answers something
 * no outbox should, or works.
 */
const breakAtRandom = (outbox: IArvoOutbox, seed: number): IArvoOutbox => {
  const random = seededRandom(seed);
  const misbehave = <Answer>(call: () => Answer): Answer => {
    const chance = random();
    if (chance < 0.2) throw new Error('the storage is down');
    // deliberately the wrong shape, as an outbox written without types could answer
    if (chance < 0.4) return JSON.parse('"not what was asked for"');
    return call();
  };
  return {
    open: () => outbox.open(),
    close: () => outbox.close(),
    readLatestState: (executionId) =>
      misbehave(() => outbox.readLatestState(executionId)),
    commitStateAndEvents: (param) =>
      misbehave(() => outbox.commitStateAndEvents(param)),
    commitEvents: (param) => misbehave(() => outbox.commitEvents(param)),
    readCommittedEvents: (filter) =>
      misbehave(() => outbox.readCommittedEvents(filter)),
    listUnseenEvents: (param) =>
      misbehave(() => outbox.listUnseenEvents(param)),
    markEventsSeen: (eventIds) =>
      misbehave(() => outbox.markEventsSeen(eventIds)),
    capacity: (request) => misbehave(() => outbox.capacity(request)),
  };
};

/** Failures every outbox meets, seen through the driver. */
export const describeSharedFailures = (subject: LoadSubject): void => {
  describe(`${subject.name}: failures forced on purpose`, () => {
    it('reports every failure of an outbox misbehaving at volume as a driver error of the right kind, throwing none', async () => {
      const opened = await subject.open();
      const driver = new ArvoOutboxDriver({
        outbox: breakAtRandom(opened.outbox, 11),
      });
      const kindCounts: Record<string, number> = {};
      try {
        for (let call = 0; call < 5000; call += 1) {
          const executionId = crypto.randomUUID();
          const answers = [
            await driver.tryCommitStateAndEvents({
              state: buildState({ executionId, casVersion: 0 }),
              events: [buildEvent({ executionId, dataBytes: 16 })],
              triggeringEvent: buildEvent({ executionId, dataBytes: 16 }),
            }),
            await driver.tryReadLatestState({ executionId }),
            await driver.tryListUnseenEvents({ atMost: 10, olderThanMs: 0 }),
            await driver.tryCapacity(),
          ];
          for (const answer of answers) {
            const kind = answer.ok ? 'ok' : answer.error.kind;
            kindCounts[kind] = (kindCounts[kind] ?? 0) + 1;
          }
        }
        expect(Object.keys(kindCounts).sort()).toEqual(
          expect.arrayContaining([
            'malformed_response',
            'malformed_state',
            'ok',
            'unavailable',
          ]),
        );
        for (const kind of Object.keys(kindCounts)) {
          expect([
            'ok',
            'unavailable',
            'malformed_response',
            'malformed_state',
            'malformed_event',
            'capacity_exhausted',
          ]).toContain(kind);
        }
        for (const [kind, kindCount] of Object.entries(kindCounts)) {
          recordMeasurement({
            check: 'outbox misbehaving at volume',
            name: kind,
            value: kindCount,
            unit: 'answers',
          });
        }
      } finally {
        await opened.close();
      }
    });
  });
};
