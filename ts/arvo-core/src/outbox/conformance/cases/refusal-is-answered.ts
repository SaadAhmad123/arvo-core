import { expect } from 'vitest';
import { buildStateCommit } from '../fixtures/state-commit.js';
import type { ArvoOutboxConformanceCase } from '../types.js';

/** A refusal is an answer, never a throw. */
export const refusalIsAnsweredCases: readonly ArvoOutboxConformanceCase[] = [
  {
    name: 'answers the commit that lost a race as refused, without throwing',
    check: async (outbox) => {
      const executionId = crypto.randomUUID();
      await outbox.commitStateAndEvents(
        buildStateCommit({ executionId, casVersion: 0 }),
      );
      const winningCommit = outbox.commitStateAndEvents(
        buildStateCommit({ executionId, casVersion: 1 }),
      );
      await expect(Promise.resolve(winningCommit)).resolves.toEqual({
        committed: true,
      });
      const losingCommit = outbox.commitStateAndEvents(
        buildStateCommit({ executionId, casVersion: 1 }),
      );
      await expect(Promise.resolve(losingCommit)).resolves.toMatchObject({
        committed: false,
      });
    },
  },
];
