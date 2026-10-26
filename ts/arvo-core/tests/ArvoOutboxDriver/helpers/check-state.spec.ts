import { describe, expect, it } from 'vitest';
import { checkState } from '../../../src/ArvoOutboxDriver/helpers/check-state.js';

describe("checking a state read's answer", () => {
  it('accepts none', () => {
    expect(checkState(null)).toEqual({ ok: true, value: null });
  });

  it('accepts a JSON object at every depth, handing on the same value', () => {
    const state = { nested: { list: [1, 'two', null, { flag: true }] } };
    const stateResult = checkState(state);
    expect(stateResult.ok && stateResult.value).toEqual(state);
  });

  it.each([
    ['an array', [1, 2]],
    ['a string', 'state'],
    ['undefined', undefined],
    ['an object holding a function', { callback: () => undefined }],
    ['an object holding a number with no JSON form', { amount: Number.NaN }],
    ['an object holding a bigint', { amount: 10n }],
  ])('refuses %s, naming where', (_answerDescription, answer) => {
    const stateResult = checkState(answer);
    expect(stateResult.ok).toBe(false);
    if (!stateResult.ok) expect(stateResult.error.length).toBeGreaterThan(0);
  });

  it('refuses an object holding itself', () => {
    const cyclicState: Record<string, unknown> = {};
    cyclicState.self = cyclicState;
    expect(checkState(cyclicState).ok).toBe(false);
  });
});
