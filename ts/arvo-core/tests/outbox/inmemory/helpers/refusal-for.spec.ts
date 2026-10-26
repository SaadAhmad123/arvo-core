import { describe, expect, it } from 'vitest';
import { refusalFor } from '../../../../src/outbox/inmemory/helpers/refusal-for.js';

describe('which refusal a commit meets', () => {
  it('meets none at the first revision with nothing stored', () => {
    expect(refusalFor({ casVersion: 0 })).toBeNull();
  });

  it('meets state_exists at the first revision with a state stored', () => {
    expect(refusalFor({ casVersion: 0, storedCasVersion: 0 })).toBe(
      'state_exists',
    );
    expect(refusalFor({ casVersion: 0, storedCasVersion: 3 })).toBe(
      'state_exists',
    );
  });

  it('meets none at the revision following the stored one', () => {
    expect(refusalFor({ casVersion: 1, storedCasVersion: 0 })).toBeNull();
    expect(refusalFor({ casVersion: 4, storedCasVersion: 3 })).toBeNull();
  });

  it('meets revision_stale at the stored revision itself', () => {
    expect(refusalFor({ casVersion: 3, storedCasVersion: 3 })).toBe(
      'revision_stale',
    );
  });

  it('meets revision_stale at a revision behind the stored one', () => {
    expect(refusalFor({ casVersion: 2, storedCasVersion: 3 })).toBe(
      'revision_stale',
    );
  });

  it('meets revision_stale at a revision skipping ahead', () => {
    expect(refusalFor({ casVersion: 5, storedCasVersion: 3 })).toBe(
      'revision_stale',
    );
  });

  it('meets revision_stale at a later revision with nothing stored', () => {
    expect(refusalFor({ casVersion: 1 })).toBe('revision_stale');
  });

  it('meets revision_stale at a revision that is no whole revision', () => {
    expect(refusalFor({ casVersion: 1.5, storedCasVersion: 0 })).toBe(
      'revision_stale',
    );
    expect(refusalFor({ casVersion: -1 })).toBe('revision_stale');
    expect(refusalFor({ casVersion: Number.NaN, storedCasVersion: 0 })).toBe(
      'revision_stale',
    );
  });
});
