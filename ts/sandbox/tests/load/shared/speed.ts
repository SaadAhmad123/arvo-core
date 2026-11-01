import { describe, expect, it } from 'vitest';
import {
  buildEvent,
  buildState,
  nestedBody,
} from '../../../src/load/harness/builders.js';
import {
  LatencySamples,
  watchThread,
} from '../../../src/load/harness/measure.js';
import { recordMeasurement } from '../../../src/load/harness/results.js';
import type { LoadSubject } from '../../../src/load/harness/subjects.js';
import { runOrders } from './lattice-check.js';

/** How fast an outbox goes: through the handlers at several concurrencies, and straight at the driver. */
export const describeSpeed = (subject: LoadSubject): void => {
  describe(`${subject.name}: speed`, () => {
    for (const workerCount of [1, 4, 16, 64]) {
      it(`runs orders through the handlers with ${workerCount} workers`, async () => {
        const check = `orders with ${workerCount} workers`;
        const opened = await subject.open();
        const thread = watchThread();
        try {
          const outcome = await runOrders({
            subject: opened,
            orderCount: 40,
            width: 10,
            depth: 2,
            workerCount,
          });
          const seconds = outcome.elapsedMs / 1000;
          recordMeasurement({
            check,
            name: 'orders per second',
            value: outcome.answeredOrders / seconds,
            unit: 'orders/s',
          });
          recordMeasurement({
            check,
            name: 'deliveries per second',
            value: outcome.deliveries / seconds,
            unit: 'deliveries/s',
          });
          recordMeasurement({
            check,
            name: 'commits per second',
            value: outcome.commits / seconds,
            unit: 'commits/s',
          });
          opened.reportTimings(check);
        } finally {
          thread.report(check);
          await opened.close();
        }
      });
    }

    // every batch size at the small payload, and the large payloads at batch sizes that fit in memory
    const batches = [
      { eventCount: 1, dataBytes: 1024 },
      { eventCount: 10, dataBytes: 1024 },
      { eventCount: 100, dataBytes: 1024 },
      { eventCount: 10_000, dataBytes: 1024 },
      { eventCount: 1, dataBytes: 100 * 1024 },
      { eventCount: 100, dataBytes: 100 * 1024 },
      { eventCount: 1, dataBytes: 1024 * 1024 },
      { eventCount: 10, dataBytes: 1024 * 1024 },
    ];
    for (const batch of batches) {
      it(`commits ${batch.eventCount} events of ${batch.dataBytes} bytes at once, and reads and sweeps them back`, async () => {
        const check = `batch of ${batch.eventCount} × ${batch.dataBytes} B`;
        const opened = await subject.open();
        try {
          const commits = new LatencySamples();
          const repeats =
            batch.eventCount * batch.dataBytes > 50 * 1024 * 1024 ? 1 : 5;
          for (let repeat = 0; repeat < repeats; repeat += 1) {
            const executionId = crypto.randomUUID();
            const events = Array.from({ length: batch.eventCount }, () =>
              buildEvent({ executionId, dataBytes: batch.dataBytes }),
            );
            const triggeringEvent = buildEvent({ executionId, dataBytes: 16 });
            const committed = await commits.time(() =>
              opened.driver.tryCommitStateAndEvents({
                state: buildState({ executionId, casVersion: 0 }),
                events,
                triggeringEvent,
              }),
            );
            expect(committed.ok).toBe(true);
            const readBack = await opened.driver.readCommittedEvents({
              filter: { triggeringEventId: triggeringEvent.id },
            });
            expect(readBack.map((entry) => entry.event?.id).sort()).toEqual(
              events.map((event) => event.id).sort(),
            );
          }
          commits.report(check, 'commit');
          const listings = new LatencySamples();
          let listedCount = 0;
          for (;;) {
            const entries = await listings.time(() =>
              opened.driver.listUnseenEvents({
                atMost: 1000,
                olderThanMs: 0,
                restoreEvents: false,
              }),
            );
            if (entries.length === 0) break;
            listedCount += entries.length;
            await opened.driver.markEventsSeen({
              eventIds: entries.map((entry) => entry.record.id),
            });
          }
          expect(listedCount).toBe(batch.eventCount * repeats);
          listings.report(check, 'list a thousand unseen');
          opened.reportTimings(check);
        } finally {
          await opened.close();
        }
      });
    }

    for (const shape of [
      { name: 'tiny', body: {} },
      { name: 'deeply nested', body: nestedBody(200) },
      {
        name: 'wide',
        body: Object.fromEntries(
          Array.from({ length: 10_000 }, (_unused, key) => [
            `field-${key}`,
            key,
          ]),
        ),
      },
    ]) {
      it(`commits and reads a ${shape.name} state, revision after revision`, async () => {
        const check = `${shape.name} state`;
        const opened = await subject.open();
        try {
          const executionId = crypto.randomUUID();
          const commits = new LatencySamples();
          const reads = new LatencySamples();
          for (let casVersion = 0; casVersion < 50; casVersion += 1) {
            const committed = await commits.time(() =>
              opened.driver.tryCommitStateAndEvents({
                state: buildState({
                  executionId,
                  casVersion,
                  body: shape.body,
                }),
                events: [],
                triggeringEvent: buildEvent({ executionId, dataBytes: 16 }),
              }),
            );
            expect(committed.ok).toBe(true);
            const latestState = await reads.time(() =>
              opened.driver.readLatestState({ executionId }),
            );
            expect(latestState).toEqual(
              buildState({ executionId, casVersion, body: shape.body }),
            );
          }
          commits.report(check, 'commit');
          reads.report(check, 'read latest');
        } finally {
          await opened.close();
        }
      });
    }
  });
};
