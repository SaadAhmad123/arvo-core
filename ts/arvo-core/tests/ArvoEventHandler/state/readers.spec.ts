import { describe, expect, it } from 'vitest';
import type { ArvoEvent } from '../../../src/ArvoEvent/index.js';
import { ARVO_EXECUTION_LIFECYCLES } from '../../../src/ArvoEventHandler/state/types.js';
import { chargedEvent, initEvent } from '../fixtures.js';
import { buildState } from './fixtures.js';

describe('whether an execution is finished', () => {
  it.each(['success', 'error', 'cancelled', 'failure'] as const)(
    'is finished at %s',
    (lifecycle) => {
      expect(buildState({ lifecycle }).isTerminal).toBe(true);
    },
  );

  it.each(['idle', 'waiting'] as const)(
    'is not finished at %s',
    (lifecycle) => {
      expect(buildState({ lifecycle }).isTerminal).toBe(false);
    },
  );

  it('judges every lifecycle the vocabulary has, and no others', () => {
    const judged = ARVO_EXECUTION_LIFECYCLES.map(
      (lifecycle) => buildState({ lifecycle }).isTerminal,
    );
    expect(judged.filter(Boolean)).toHaveLength(4);
    expect(judged).toHaveLength(6);
  });
});

describe('whether everything awaited has been answered', () => {
  it('is complete where it awaits nothing', () => {
    const state = buildState({
      inFlightEventMap: new Map<string, ArvoEvent | null>(),
    });
    expect(state.isCollectionComplete).toBe(true);
  });

  it('is complete where every request holds an answer', () => {
    const state = buildState({
      inFlightEventMap: new Map<string, ArvoEvent | null>([
        ['one', chargedEvent],
        ['two', chargedEvent],
      ]),
    });
    expect(state.isCollectionComplete).toBe(true);
  });

  it('is incomplete where one is still unanswered', () => {
    const state = buildState({
      inFlightEventMap: new Map<string, ArvoEvent | null>([
        ['one', chargedEvent],
        ['two', null],
      ]),
    });
    expect(state.isCollectionComplete).toBe(false);
  });

  it('is incomplete where none has been answered', () => {
    const state = buildState({
      inFlightEventMap: new Map<string, ArvoEvent | null>([['one', null]]),
    });
    expect(state.isCollectionComplete).toBe(false);
  });
});

describe('who an execution is and where it sits', () => {
  it('groups the five fields that say so', () => {
    const state = buildState({ depth: 3 });
    expect(state.identity).toEqual({
      subject: initEvent.subject,
      executionId: initEvent.executionid,
      parentExecutionId: initEvent.executionid,
      depth: 3,
      version: '1.0.0',
    });
  });

  it('reads the same as each field read on its own', () => {
    const state = buildState();
    expect(state.identity.subject).toBe(state.subject);
    expect(state.identity.executionId).toBe(state.executionId);
    expect(state.identity.parentExecutionId).toBe(state.parentExecutionId);
    expect(state.identity.depth).toBe(state.depth);
    expect(state.identity.version).toBe(state.version);
  });

  it('carries nothing beyond those five', () => {
    expect(Object.keys(buildState().identity).sort()).toEqual([
      'depth',
      'executionId',
      'parentExecutionId',
      'subject',
      'version',
    ]);
  });
});
