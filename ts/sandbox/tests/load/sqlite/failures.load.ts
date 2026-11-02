import {
  chmodSync,
  closeSync,
  existsSync,
  openSync,
  rmSync,
  writeSync,
} from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildEvent,
  buildRecord,
  buildState,
} from '../../../src/load/harness/builders.js';
import { startChild } from '../../../src/load/harness/processes.js';
import { writeAsAnotherConnection } from '../../../src/load/harness/sqlite-file.js';
import { sqliteSubject } from '../../../src/load/harness/subjects.js';

/** A commit through the driver of one new execution, with one event. */
const commitOne = (
  driver: Awaited<ReturnType<typeof sqliteSubject.open>>['driver'],
) => {
  const executionId = crypto.randomUUID();
  return driver.tryCommitStateAndEvents({
    state: buildState({ executionId, casVersion: 0 }),
    events: [buildEvent({ executionId, dataBytes: 16 })],
    triggeringEvent: buildEvent({ executionId, dataBytes: 16 }),
  });
};

describe('sqlite: failures forced on purpose', () => {
  it('opens a file whose writer was killed mid-commit, holding all of each commit or none of it', async () => {
    const opened = await sqliteSubject.open();
    const filename = opened.filename ?? '';
    await opened.close();
    for (let kill = 0; kill < 5; kill += 1) {
      const executionIds = Array.from({ length: 40 }, () =>
        crypto.randomUUID(),
      );
      const committer = startChild<{ kind: string; executionId?: string }>(
        'sqlite-committer',
        {
          filename,
          executionIds,
          eventsPerCommit: 2000,
        },
      );
      await committer.nextMessage(
        (message) =>
          message.kind === 'committing' &&
          message.executionId === executionIds[3 + kill],
      );
      await new Promise((settle) => setTimeout(settle, kill * 3));
      committer.child.kill('SIGKILL');
      expect((await committer.ended).signal).toBe('SIGKILL');
      const reopened = await sqliteSubject.open({ sqlite: { filename } });
      try {
        for (const executionId of executionIds) {
          const events = await reopened.driver.readCommittedEvents({
            filter: { executionId },
            restoreEvents: false,
          });
          const latestState = await reopened.driver.readLatestState({
            executionId,
          });
          expect([0, 2000]).toContain(events.length);
          expect(latestState === null).toBe(events.length === 0);
        }
      } finally {
        await reopened.driver.close();
      }
    }
    for (const suffix of ['', '-wal', '-shm'])
      rmSync(`${filename}${suffix}`, { force: true });
  });

  it('fails cleanly on a file made read-only, and works again once it is writable', async () => {
    const opened = await sqliteSubject.open();
    const filename = opened.filename ?? '';
    await opened.driver.close();
    chmodSync(filename, 0o444);
    try {
      let reopened: Awaited<ReturnType<typeof sqliteSubject.open>> | null =
        null;
      try {
        reopened = await sqliteSubject.open({ sqlite: { filename } });
        const committed = await commitOne(reopened.driver);
        expect(!committed.ok && committed.error.kind).toBe('unavailable');
      } catch (error_) {
        expect(error_).toBeInstanceOf(Error);
      } finally {
        await reopened?.driver.close().catch(() => undefined);
      }
    } finally {
      // SQLite's side files take the main file's permissions: a repair covers all three
      for (const suffix of ['', '-wal', '-shm']) {
        if (existsSync(`${filename}${suffix}`))
          chmodSync(`${filename}${suffix}`, 0o600);
      }
    }
    const writable = await sqliteSubject.open({ sqlite: { filename } });
    try {
      expect((await commitOne(writable.driver)).ok).toBe(true);
    } finally {
      await writable.close();
    }
  });

  it('keeps answering, without crashing, once its file is deleted while open, and a new outbox starts a new file', async () => {
    const opened = await sqliteSubject.open();
    const filename = opened.filename ?? '';
    try {
      expect((await commitOne(opened.driver)).ok).toBe(true);
      rmSync(filename);
      for (let commit = 0; commit < 50; commit += 1) {
        const committed = await commitOne(opened.driver);
        if (!committed.ok) expect(committed.error.kind).toBe('unavailable');
      }
    } finally {
      await opened.driver.close();
    }
    for (const suffix of ['-wal', '-shm'])
      rmSync(`${filename}${suffix}`, { force: true });
    const fresh = await sqliteSubject.open({ sqlite: { filename } });
    try {
      expect(
        await fresh.driver.listUnseenEvents({ atMost: 10, olderThanMs: 0 }),
      ).toEqual([]);
      expect(existsSync(filename)).toBe(true);
    } finally {
      await fresh.close();
    }
  });

  it('fails cleanly on a corrupted file, crashing nothing', async () => {
    const opened = await sqliteSubject.open();
    const filename = opened.filename ?? '';
    for (let batch = 0; batch < 5; batch += 1) {
      await opened.outbox.commitEvents({
        events: Array.from({ length: 200 }, () =>
          buildRecord({ payloadBytes: 256 }),
        ),
      });
    }
    await opened.driver.close();
    for (const suffix of ['-wal', '-shm'])
      rmSync(`${filename}${suffix}`, { force: true });
    const fileHandle = openSync(filename, 'r+');
    writeSync(fileHandle, Buffer.alloc(8192, 0x5a), 0, 8192, 4096);
    closeSync(fileHandle);
    let reopened: Awaited<ReturnType<typeof sqliteSubject.open>> | null = null;
    try {
      reopened = await sqliteSubject.open({ sqlite: { filename } });
      const listed = await reopened.driver.tryListUnseenEvents({
        atMost: 1000,
        olderThanMs: 0,
      });
      if (!listed.ok)
        expect([
          'unavailable',
          'malformed_event',
          'malformed_response',
        ]).toContain(listed.error.kind);
    } catch (error_) {
      expect(error_).toBeInstanceOf(Error);
    } finally {
      await reopened?.driver.close().catch(() => undefined);
      for (const suffix of ['', '-wal', '-shm'])
        rmSync(`${filename}${suffix}`, { force: true });
    }
  });

  it('refuses a file written by a newer release, changing nothing', async () => {
    const opened = await sqliteSubject.open();
    const filename = opened.filename ?? '';
    await opened.driver.close();
    writeAsAnotherConnection(filename, (otherConnection) =>
      otherConnection.pragma('user_version = 99'),
    );
    await expect(sqliteSubject.open({ sqlite: { filename } })).rejects.toThrow(
      'knows only versions up to',
    );
    expect(
      writeAsAnotherConnection(filename, (otherConnection) =>
        otherConnection.pragma('user_version', { simple: true }),
      ),
    ).toBe(99);
    for (const suffix of ['', '-wal', '-shm'])
      rmSync(`${filename}${suffix}`, { force: true });
  });
});
