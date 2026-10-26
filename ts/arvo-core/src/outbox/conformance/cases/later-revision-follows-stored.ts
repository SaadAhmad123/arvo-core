import { expect } from 'vitest';
import { buildStateCommit } from '../fixtures/state-commit.js';
import type { ArvoOutboxConformanceCase } from '../types.js';

/** Every later revision follows the stored one by exactly one. */
export const laterRevisionFollowsStoredCases: readonly ArvoOutboxConformanceCase[] =
  [
    {
      name: 'commits the revision that follows the stored one',
      check: async (outbox) => {
        const executionId = crypto.randomUUID();
        await outbox.commitStateAndEvents(
          buildStateCommit({ executionId, casVersion: 0 }),
        );
        expect(
          await outbox.commitStateAndEvents(
            buildStateCommit({ executionId, casVersion: 1 }),
          ),
        ).toEqual({ committed: true });
      },
    },
    {
      name: 'refuses the stored revision itself as revision_stale',
      check: async (outbox) => {
        const executionId = crypto.randomUUID();
        await outbox.commitStateAndEvents(
          buildStateCommit({ executionId, casVersion: 0 }),
        );
        await outbox.commitStateAndEvents(
          buildStateCommit({ executionId, casVersion: 1 }),
        );
        expect(
          await outbox.commitStateAndEvents(
            buildStateCommit({ executionId, casVersion: 1 }),
          ),
        ).toEqual({ committed: false, refusal: 'revision_stale' });
      },
    },
    {
      name: 'refuses a revision that skips ahead as revision_stale',
      check: async (outbox) => {
        const executionId = crypto.randomUUID();
        await outbox.commitStateAndEvents(
          buildStateCommit({ executionId, casVersion: 0 }),
        );
        expect(
          await outbox.commitStateAndEvents(
            buildStateCommit({ executionId, casVersion: 2 }),
          ),
        ).toEqual({ committed: false, refusal: 'revision_stale' });
      },
    },
    {
      name: 'refuses a later revision with nothing stored as revision_stale',
      check: async (outbox) => {
        expect(
          await outbox.commitStateAndEvents(
            buildStateCommit({
              executionId: crypto.randomUUID(),
              casVersion: 1,
            }),
          ),
        ).toEqual({ committed: false, refusal: 'revision_stale' });
      },
    },
  ];
