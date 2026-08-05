import { describe, expect, it } from 'vitest';
import { createTimestamp, truncate } from '../src/utils.js';

describe('createTimestamp', () => {
  it('returns the current instant as an RFC 3339 timestamp in UTC, suffixed Z', () => {
    expect(createTimestamp()).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
  });

  it('is already in the canonical form Date.prototype.toISOString() produces', () => {
    const value = createTimestamp();
    expect(new Date(value).toISOString()).toBe(value);
  });
});

describe('truncate', () => {
  it('returns text unchanged when shorter than maxLength', () => {
    expect(truncate('hello', 10)).toBe('hello');
  });

  it('returns text unchanged when exactly maxLength', () => {
    expect(truncate('hello', 5)).toBe('hello');
  });

  it('truncates text longer than maxLength, ending in an ellipsis', () => {
    const result = truncate('hello world', 5);
    expect(result).toBe('hell…');
    expect(result).toHaveLength(5);
  });

  it('truncated output is always exactly maxLength characters', () => {
    expect(truncate('a'.repeat(200), 80)).toHaveLength(80);
    expect(truncate('a'.repeat(9), 3)).toHaveLength(3);
  });

  it('returns an empty string unchanged', () => {
    expect(truncate('', 10)).toBe('');
  });

  it('handles maxLength of 0 without a negative slice', () => {
    expect(truncate('hello', 0)).toBe('…');
  });

  it('handles maxLength of 1 as just the ellipsis', () => {
    expect(truncate('hello', 1)).toBe('…');
  });
});
