import { describe, expect, it } from 'vitest';
import { checkCommitOutcome } from '../../../src/ArvoOutboxDriver/helpers/check-commit-outcome.js';

describe("checking a commit's answer", () => {
  it.each([
    { committed: true },
    { committed: false, refusal: 'state_exists' },
    { committed: false, refusal: 'revision_stale' },
    { committed: false, refusal: 'capacity_exhausted' },
  ])('accepts %o', (outcome) => {
    expect(checkCommitOutcome(outcome)).toEqual({ ok: true, value: outcome });
  });

  it('hands back no refusal beside a commit that landed', () => {
    expect(
      checkCommitOutcome({ committed: true, refusal: 'state_exists' }),
    ).toEqual({ ok: true, value: { committed: true } });
  });

  it.each([
    ['none', null, 'outcome'],
    ['nothing', undefined, 'outcome'],
    ['a boolean', true, 'outcome'],
    ['an object with no committed', {}, 'outcome.committed'],
    [
      'committed that is not a boolean',
      { committed: 'yes' },
      'outcome.committed',
    ],
    [
      'a refusal of no known kind',
      { committed: false, refusal: 'busy' },
      'outcome.refusal',
    ],
    ['a refusal missing', { committed: false }, 'outcome.refusal'],
  ])(
    'refuses %s, with one issue at its path',
    (_answerDescription, answer, path) => {
      const outcomeResult = checkCommitOutcome(answer);
      expect(
        !outcomeResult.ok && outcomeResult.error.map((issue) => issue.path),
      ).toEqual([path]);
    },
  );
});
