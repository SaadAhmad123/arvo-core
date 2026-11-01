import { describe, expect, it } from 'vitest';
import {
  buildEvent,
  buildState,
  waitMs,
} from '../../../src/load/harness/builders.js';
import { LatencySamples } from '../../../src/load/harness/measure.js';
import { startChild } from '../../../src/load/harness/processes.js';
import { recordMeasurement } from '../../../src/load/harness/results.js';
import { countRows } from '../../../src/load/harness/sqlite-file.js';
import { sqliteSubject } from '../../../src/load/harness/subjects.js';

type CommitterMessage = {
  kind: string;
  executionId?: string;
  landed?: boolean;
};
type SweeperMessage = { kind: string; eventIds?: string[] };

describe('sqlite: several processes on one file', () => {
  it('lets one of six processes land each revision they race for, while two sweepers hand each event out once', async () => {
    const opened = await sqliteSubject.open();
    try {
      const executionIds = Array.from({ length: 200 }, () =>
        crypto.randomUUID(),
      );
      const sweepers = Array.from({ length: 2 }, () =>
        startChild<SweeperMessage>('sqlite-sweeper', {
          filename: opened.filename,
          leaseMs: 60_000,
        }),
      );
      await Promise.all(
        sweepers.map((sweeper) =>
          sweeper.nextMessage((message) => message.kind === 'ready'),
        ),
      );
      const startedAt = Date.now();
      const committers = Array.from({ length: 6 }, () =>
        startChild<CommitterMessage>('sqlite-committer', {
          filename: opened.filename,
          executionIds,
          eventsPerCommit: 5,
        }),
      );
      await Promise.all(committers.map((committer) => committer.ended));
      recordMeasurement({
        check: 'six committers on one file',
        name: 'time to commit',
        value: Date.now() - startedAt,
        unit: 'ms',
      });
      const landedCountById = new Map<string, number>();
      for (const message of committers.flatMap(
        (committer) => committer.messages,
      )) {
        if (
          message.kind === 'committed' &&
          message.landed === true &&
          message.executionId !== undefined
        ) {
          landedCountById.set(
            message.executionId,
            (landedCountById.get(message.executionId) ?? 0) + 1,
          );
        }
      }
      expect(landedCountById.size).toBe(200);
      expect(
        [...landedCountById.values()].every((landedCount) => landedCount === 1),
      ).toBe(true);
      // the sweepers drain what landed
      for (let waited = 0; waited < 300; waited += 1) {
        const handed = sweepers
          .flatMap((sweeper) => sweeper.messages)
          .flatMap((message) => message.eventIds ?? []);
        if (handed.length >= 1000) break;
        await waitMs(100);
      }
      for (const sweeper of sweepers) sweeper.child.send({ kind: 'stop' });
      await Promise.all(sweepers.map((sweeper) => sweeper.ended));
      const handedEventIds = sweepers
        .flatMap((sweeper) => sweeper.messages)
        .flatMap((message) => message.eventIds ?? []);
      expect(handedEventIds).toHaveLength(1000);
      expect(new Set(handedEventIds).size).toBe(1000);
      expect(countRows(opened.filename ?? '')).toEqual({
        events: 1000,
        states: 200,
      });
    } finally {
      await opened.close();
    }
  });

  it('reports a commit as unavailable, storing nothing, while another writer holds the file past the wait, and commits once it lets go', async () => {
    const opened = await sqliteSubject.open({ sqlite: { busyTimeoutMs: 200 } });
    try {
      const lockHolder = startChild<{ kind: string }>('sqlite-lock-holder', {
        filename: opened.filename,
        holdMs: 2000,
      });
      await lockHolder.nextMessage((message) => message.kind === 'holding');
      const executionId = crypto.randomUUID();
      const commitParam = {
        state: buildState({ executionId, casVersion: 0 }),
        events: [buildEvent({ executionId, dataBytes: 16 })],
        triggeringEvent: buildEvent({ executionId, dataBytes: 16 }),
      };
      const waiting = new LatencySamples();
      const blocked = await waiting.time(() =>
        opened.driver.tryCommitStateAndEvents(commitParam),
      );
      waiting.report('a writer holding the file', 'blocked commit');
      expect(!blocked.ok && blocked.error.kind).toBe('unavailable');
      await lockHolder.nextMessage((message) => message.kind === 'released');
      expect(await opened.driver.readLatestState({ executionId })).toBeNull();
      expect(
        (await opened.driver.tryCommitStateAndEvents(commitParam)).ok,
      ).toBe(true);
    } finally {
      await opened.close();
    }
  });

  it('keeps two outboxes on one file in one process consistent', async () => {
    const first = await sqliteSubject.open();
    const second = await sqliteSubject.open({
      sqlite: { filename: first.filename ?? '' },
    });
    try {
      const executionId = crypto.randomUUID();
      const commits = await Promise.all(
        [first, second].map((opened) =>
          opened.driver.tryCommitStateAndEvents({
            state: buildState({ executionId, casVersion: 0 }),
            events: [],
            triggeringEvent: buildEvent({ executionId, dataBytes: 16 }),
          }),
        ),
      );
      expect(commits.filter((commit) => commit.ok)).toHaveLength(1);
      expect(await second.driver.readLatestState({ executionId })).toEqual(
        await first.driver.readLatestState({ executionId }),
      );
    } finally {
      await second.driver.close();
      await first.close();
    }
  });
});
