import { expect } from 'vitest';
import { buildStateCommit } from '../fixtures/state-commit.js';
import type { ArvoOutboxConformanceCase } from '../types.js';

/** A state comes back as the same JSON value it was committed as. */
export const stateIsReturnedUnchangedCases: readonly ArvoOutboxConformanceCase[] =
  [
    {
      name: 'returns a state with nested values exactly as committed',
      check: async (outbox) => {
        const executionId = crypto.randomUUID();
        const state = {
          nested: { list: [1, null, 'text', { flag: true }], empty: {} },
          numbers: [0, -1.5, 0.1, Number.MAX_SAFE_INTEGER],
          nothing: null,
          emptyList: [],
          text: 'é ☃ "quoted" \\ back',
        };
        await outbox.commitStateAndEvents(
          buildStateCommit({ executionId, casVersion: 0, state }),
        );
        expect(await outbox.readLatestState(executionId)).toStrictEqual(state);
      },
    },
    {
      name: 'stores a state it could not interpret as given',
      check: async (outbox) => {
        const executionId = crypto.randomUUID();
        const state = { notAnExecutionRecord: true, lifecycle: 42 };
        await outbox.commitStateAndEvents(
          buildStateCommit({ executionId, casVersion: 0, state }),
        );
        expect(await outbox.readLatestState(executionId)).toStrictEqual(state);
      },
    },
  ];
