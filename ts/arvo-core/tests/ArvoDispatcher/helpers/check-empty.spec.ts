import { describe, expect, it } from 'vitest';
import { checkEmpty } from '../../../src/ArvoDispatcher/helpers/check-empty.js';
import { orderHandler } from '../fixtures.js';

describe('the empty-set rule', () => {
  it('accepts a set holding a handler', () => {
    expect(checkEmpty([orderHandler()])).toEqual([]);
  });

  it('refuses an empty set, blocking every other rule', () => {
    const [issue] = checkEmpty([]);
    expect(issue?.path).toBe('handlers');
    expect(issue?.message).toContain('at least one handler');
    expect(issue?.isBlocking).toBe(true);
  });
});
