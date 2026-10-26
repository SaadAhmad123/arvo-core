import { expect } from 'vitest';
import { buildStateCommit } from '../fixtures/state-commit.js';
import type { ArvoOutboxConformanceCase } from '../types.js';

/** The latest state is read from what is stored, on every call. */
export const latestStateIsReadLiveCases: readonly ArvoOutboxConformanceCase[] =
  [
    {
      name: 'returns no state for an execution never committed',
      check: async (outbox) => {
        expect(await outbox.readLatestState(crypto.randomUUID())).toBeNull();
      },
    },
    {
      name: 'returns a state as soon as it is committed, not one read earlier',
      check: async (outbox) => {
        const executionId = crypto.randomUUID();
        expect(await outbox.readLatestState(executionId)).toBeNull();
        await outbox.commitStateAndEvents(
          buildStateCommit({
            executionId,
            casVersion: 0,
            state: { step: 'first' },
          }),
        );
        expect(await outbox.readLatestState(executionId)).toEqual({
          step: 'first',
        });
        await outbox.commitStateAndEvents(
          buildStateCommit({
            executionId,
            casVersion: 1,
            state: { step: 'second' },
          }),
        );
        expect(await outbox.readLatestState(executionId)).toEqual({
          step: 'second',
        });
      },
    },
    {
      name: 'returns the state at the highest revision',
      check: async (outbox) => {
        const executionId = crypto.randomUUID();
        for (const casVersion of [0, 1, 2]) {
          await outbox.commitStateAndEvents(
            buildStateCommit({
              executionId,
              casVersion,
              state: { casVersion },
            }),
          );
        }
        expect(await outbox.readLatestState(executionId)).toEqual({
          casVersion: 2,
        });
      },
    },
  ];
