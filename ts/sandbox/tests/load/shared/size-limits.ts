import { describe, expect, it } from 'vitest';
import {
  buildEvent,
  buildRecord,
  buildState,
} from '../../../src/load/harness/builders.js';
import { LatencySamples } from '../../../src/load/harness/measure.js';
import { recordMeasurement } from '../../../src/load/harness/results.js';
import type { LoadSubject } from '../../../src/load/harness/subjects.js';

/** An outbox at the sizes a deployment may reach. */
export const describeSizeLimits = (subject: LoadSubject): void => {
  describe(`${subject.name}: size limits`, () => {
    it('holds a million events, answering every operation there', async () => {
      const check = 'a million events';
      const opened = await subject.open();
      try {
        const committing = new LatencySamples();
        const sampleTriggeringEventIds: string[] = [];
        for (let batch = 0; batch < 100; batch += 1) {
          const records = Array.from({ length: 10_000 }, () =>
            buildRecord({ payloadBytes: 16 }),
          );
          sampleTriggeringEventIds.push(records[0]?.triggeringEventId ?? '');
          await committing.time(() =>
            opened.outbox.commitEvents({ events: records }),
          );
        }
        committing.report(check, 'commit ten thousand');
        const capacity = await opened.driver.capacity();
        recordMeasurement({
          check,
          name: 'memory after',
          value: process.memoryUsage().rss / 1024 / 1024,
          unit: 'MB',
        });
        if (subject.name === 'inmemory')
          expect(capacity.buffers.events?.held).toBe(1_000_001);
        const reads = new LatencySamples();
        for (const triggeringEventId of sampleTriggeringEventIds) {
          const entries = await reads.time(() =>
            opened.driver.readCommittedEvents({
              filter: { triggeringEventId },
              // written straight to the outbox, so not events the driver can restore
              restoreEvents: false,
            }),
          );
          expect(entries).toHaveLength(1);
        }
        reads.report(check, 'read one delivery');
        const listings = new LatencySamples();
        let previousLast = '';
        for (let round = 0; round < 20; round += 1) {
          const entries = await listings.time(() =>
            opened.driver.listUnseenEvents({
              atMost: 1000,
              olderThanMs: 0,
              restoreEvents: false,
            }),
          );
          expect(entries).toHaveLength(1000);
          const committedAts = entries.map((entry) => entry.record.committedAt);
          expect(committedAts).toEqual([...committedAts].sort());
          expect((committedAts[0] ?? '') >= previousLast).toBe(true);
          previousLast = committedAts.at(-1) ?? '';
          await opened.driver.markEventsSeen({
            eventIds: entries.map((entry) => entry.record.id),
          });
        }
        listings.report(check, 'list a thousand unseen');
        opened.reportTimings(check);
      } finally {
        await opened.close();
      }
    });

    it('holds a hundred thousand executions', async () => {
      const check = 'a hundred thousand executions';
      const opened = await subject.open();
      try {
        const executionIds = Array.from({ length: 100_000 }, () =>
          crypto.randomUUID(),
        );
        const commits = new LatencySamples();
        for (const executionId of executionIds) {
          await commits.time(() =>
            opened.outbox.commitStateAndEvents({
              executionId,
              casVersion: 0,
              subject: executionId,
              source: 'com_load_source',
              version: '1.0.0',
              lifecycle: 'waiting',
              state: buildState({ executionId, casVersion: 0 }),
              events: [],
            }),
          );
        }
        commits.report(check, 'commit a new execution');
        const reads = new LatencySamples();
        for (const executionId of executionIds.slice(0, 1000)) {
          const latestState = await reads.time(() =>
            opened.driver.readLatestState({ executionId }),
          );
          expect(latestState).not.toBeNull();
        }
        reads.report(check, 'read latest');
      } finally {
        await opened.close();
      }
    });

    it('reads back an execution with a long history', async () => {
      const check = 'an execution ten thousand revisions long';
      const opened = await subject.open();
      try {
        const executionId = crypto.randomUUID();
        for (let casVersion = 0; casVersion < 10_000; casVersion += 1) {
          const committed = await opened.driver.tryCommitStateAndEvents({
            state: buildState({ executionId, casVersion }),
            events: [buildEvent({ executionId, dataBytes: 32 })],
            triggeringEvent: buildEvent({ executionId, dataBytes: 16 }),
          });
          expect(committed.ok).toBe(true);
        }
        const reads = new LatencySamples();
        const entries = await reads.time(() =>
          opened.driver.readCommittedEvents({
            filter: { executionId },
            restoreEvents: false,
          }),
        );
        expect(entries).toHaveLength(10_000);
        reads.report(check, 'read every event it committed');
      } finally {
        await opened.close();
      }
    });
  });
};
