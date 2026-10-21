import { describe, expect, it } from 'vitest';
import { atNextRevision } from '../../../src/ArvoEventHandler/state/revision.js';
import { buildState } from './fixtures.js';

describe('the revision a record is committed under', () => {
  it('is the one it was built at, where this execution opened it', () => {
    const openingState = buildState({ casVersion: 0 });
    expect(atNextRevision(openingState, 'init').casVersion).toBe(0);
  });

  it('is the one after what was read, where this execution read a record', () => {
    expect(atNextRevision(buildState(), 'followup').casVersion).toBe(8);
  });

  it('leaves the record it was given exactly as it was', () => {
    const readState = buildState();
    atNextRevision(readState, 'followup');
    expect(readState.casVersion).toBe(7);
  });

  it('changes nothing else about the record', () => {
    const readState = buildState();
    const revisedState = atNextRevision(readState, 'followup');
    expect(revisedState.lifecycle).toBe(readState.lifecycle);
    expect(revisedState.data).toEqual(readState.data);
    expect(revisedState.eventIds).toEqual(readState.eventIds);
  });
});
