import { expect } from 'vitest';
import { buildStateCommit } from '../fixtures/state-commit.js';
import type { ArvoOutboxConformanceCase } from '../types.js';

/** A state is keyed and compared by the commit's fields, never its own. */
export const nothingIsReadOffTheStateCases: readonly ArvoOutboxConformanceCase[] =
  [
    {
      name: 'keys a state by the commit, not by what the state names',
      check: async (outbox) => {
        const executionId = crypto.randomUUID();
        const executionIdInState = crypto.randomUUID();
        const state = { executionId: executionIdInState, casVersion: 7 };
        await outbox.commitStateAndEvents(
          buildStateCommit({ executionId, casVersion: 0, state }),
        );
        expect(await outbox.readLatestState(executionId)).toStrictEqual(state);
        expect(await outbox.readLatestState(executionIdInState)).toBeNull();
        expect(
          await outbox.commitStateAndEvents(
            buildStateCommit({ executionId, casVersion: 1 }),
          ),
        ).toEqual({ committed: true });
      },
    },
  ];
