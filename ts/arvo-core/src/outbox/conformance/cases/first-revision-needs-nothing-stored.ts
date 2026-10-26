import { expect } from 'vitest';
import { buildStateCommit } from '../fixtures/state-commit.js';
import type { ArvoOutboxConformanceCase } from '../types.js';

/** The first revision is committed only where nothing is stored. */
export const firstRevisionNeedsNothingStoredCases: readonly ArvoOutboxConformanceCase[] =
  [
    {
      name: 'commits the first state of an execution',
      check: async (outbox) => {
        expect(
          await outbox.commitStateAndEvents(
            buildStateCommit({
              executionId: crypto.randomUUID(),
              casVersion: 0,
            }),
          ),
        ).toEqual({ committed: true });
      },
    },
    {
      name: 'refuses a second first state as state_exists',
      check: async (outbox) => {
        const executionId = crypto.randomUUID();
        await outbox.commitStateAndEvents(
          buildStateCommit({ executionId, casVersion: 0 }),
        );
        expect(
          await outbox.commitStateAndEvents(
            buildStateCommit({ executionId, casVersion: 0 }),
          ),
        ).toEqual({ committed: false, refusal: 'state_exists' });
      },
    },
  ];
