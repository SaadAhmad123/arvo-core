import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildEvent, buildState } from '../../../src/load/harness/builders.js';
import { recordSkip } from '../../../src/load/harness/results.js';
import { sqliteSubject } from '../../../src/load/harness/subjects.js';

const CHECK =
  'fails a commit cleanly when its disk fills, holding nothing of it, and commits once space is freed';

describe('sqlite: a full disk', () => {
  it(CHECK, async (context) => {
    const disk = process.env.LOAD_DISK;
    if (disk === undefined) {
      recordSkip({
        check: CHECK,
        reason: 'needs the size-capped disk only the full-disk container has',
      });
      context.skip();
      return;
    }
    // room set aside, to give back once the disk is full
    const spareFile = join(disk, 'spare');
    writeFileSync(spareFile, Buffer.alloc(3 * 1024 * 1024, 1));
    const opened = await sqliteSubject.open();
    const committedIds: string[] = [];
    let refusedId: string | null = null;
    try {
      for (
        let attempt = 0;
        attempt < 10_000 && refusedId === null;
        attempt += 1
      ) {
        const executionId = crypto.randomUUID();
        const committed = await opened.driver.tryCommitStateAndEvents({
          state: buildState({ executionId, casVersion: 0 }),
          events: Array.from({ length: 50 }, () =>
            buildEvent({ executionId, dataBytes: 1024 }),
          ),
          triggeringEvent: buildEvent({ executionId, dataBytes: 16 }),
        });
        if (committed.ok) committedIds.push(executionId);
        else {
          expect(committed.error.kind).toBe('unavailable');
          expect(String(committed.error.cause)).toMatch(/full|disk/i);
          refusedId = executionId;
        }
      }
      expect(refusedId).not.toBeNull();
    } finally {
      await opened.driver.close().catch(() => undefined);
    }
    rmSync(spareFile);
    const reopened = await sqliteSubject.open({
      sqlite: { filename: opened.filename ?? '' },
    });
    try {
      expect(
        await reopened.driver.readLatestState({ executionId: refusedId ?? '' }),
      ).toBeNull();
      expect(
        await reopened.driver.readCommittedEvents({
          filter: { executionId: refusedId ?? '' },
        }),
      ).toEqual([]);
      for (const executionId of committedIds.slice(-5)) {
        const events = await reopened.driver.readCommittedEvents({
          filter: { executionId },
          restoreEvents: false,
        });
        expect(events).toHaveLength(50);
      }
      const executionId = crypto.randomUUID();
      const afterFreeing = await reopened.driver.tryCommitStateAndEvents({
        state: buildState({ executionId, casVersion: 0 }),
        events: [buildEvent({ executionId, dataBytes: 1024 })],
        triggeringEvent: buildEvent({ executionId, dataBytes: 16 }),
      });
      expect(afterFreeing.ok).toBe(true);
    } finally {
      await reopened.close();
    }
  });
});
