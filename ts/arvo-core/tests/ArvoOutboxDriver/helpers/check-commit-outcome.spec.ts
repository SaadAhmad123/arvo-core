import { describe, expect, it } from 'vitest';
import { checkCommitOutcome } from '../../../src/ArvoOutboxDriver/helpers/check-commit-outcome.js';

describe("checking a commit's answer", () => {
  it.each([
    { committed: true },
    { committed: false, refusal: 'state_exists' },
    { committed: false, refusal: 'revision_stale' },
  ])('accepts %o', (outcome) => {
    expect(checkCommitOutcome(outcome)).toEqual({ ok: true, value: outcome });
  });

  it.each([
    ['none', null],
    ['undefined', undefined],
    ['a boolean', true],
    ['an object with no committed', {}],
    ['committed that is not a boolean', { committed: 'yes' }],
    ['a refusal of no known kind', { committed: false, refusal: 'busy' }],
    ['a refusal missing', { committed: false }],
  ])('refuses %s', (_answerDescription, answer) => {
    const outcomeResult = checkCommitOutcome(answer);
    expect(outcomeResult.ok).toBe(false);
    if (!outcomeResult.ok) expect(outcomeResult.error.length).toBe(1);
  });
});
