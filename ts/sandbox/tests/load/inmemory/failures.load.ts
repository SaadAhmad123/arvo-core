import { describe, expect, it } from 'vitest';
import { buildEvent, buildState } from '../../../src/load/harness/builders.js';
import { inMemorySubject } from '../../../src/load/harness/subjects.js';

describe('inmemory: failures forced on purpose', () => {
  it('reports a commit and a listing as unavailable while its clock throws or answers no time, and recovers after', async () => {
    let clockFailure: 'throws' | 'invalid' | null = null;
    const opened = await inMemorySubject.open({
      inmemory: {
        clock: () => {
          if (clockFailure === 'throws') throw new Error('the clock is gone');
          return clockFailure === 'invalid' ? new Date(Number.NaN) : new Date();
        },
      },
    });
    try {
      for (const failure of ['throws', 'invalid'] as const) {
        clockFailure = failure;
        const executionId = crypto.randomUUID();
        const committed = await opened.driver.tryCommitStateAndEvents({
          state: buildState({ executionId, casVersion: 0 }),
          events: [buildEvent({ executionId, dataBytes: 16 })],
          triggeringEvent: buildEvent({ executionId, dataBytes: 16 }),
        });
        expect(!committed.ok && committed.error.kind).toBe('unavailable');
        expect(await opened.driver.readLatestState({ executionId })).toBeNull();
        const listed = await opened.driver.tryListUnseenEvents({
          atMost: 10,
          olderThanMs: 0,
        });
        expect(!listed.ok && listed.error.kind).toBe('unavailable');
        clockFailure = null;
        const retried = await opened.driver.tryCommitStateAndEvents({
          state: buildState({ executionId, casVersion: 0 }),
          events: [buildEvent({ executionId, dataBytes: 16 })],
          triggeringEvent: buildEvent({ executionId, dataBytes: 16 }),
        });
        expect(retried.ok).toBe(true);
      }
    } finally {
      await opened.close();
    }
  });
});
