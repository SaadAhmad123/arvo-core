import { describe, expect, it } from 'vitest';
import { atNextRevision } from '../../../src/ArvoEventHandler/state/revision.js';
import { buildState } from './fixtures.js';

describe('the revision a record is committed under', () => {
  it('is the one it was built at, where this execution opened it', () => {
    const opened = buildState({ casVersion: 0 });
    expect(atNextRevision(opened, 'init').casVersion).toBe(0);
  });

  it('is the one after what was read, where this execution read a record', () => {
    expect(atNextRevision(buildState(), 'followup').casVersion).toBe(8);
  });

  it('leaves the record it was given exactly as it was', () => {
    const read = buildState();
    atNextRevision(read, 'followup');
    expect(read.casVersion).toBe(7);
  });

  it('changes nothing else about the record', () => {
    const read = buildState();
    const next = atNextRevision(read, 'followup');
    expect(next.lifecycle).toBe(read.lifecycle);
    expect(next.data).toEqual(read.data);
    expect(next.eventIds).toEqual(read.eventIds);
  });
});
