import { describe, expect, it } from 'vitest';
import { createTimestamp, truncate } from '../src/utils.js';

describe('createTimestamp', () => {
  it('defaults to a UTC offset (+00:00) when no offset is provided', () => {
    expect(createTimestamp()).toMatch(/\+00:00$/);
  });

  it('formats a positive offset with a + sign', () => {
    expect(createTimestamp(2)).toMatch(/\+02:00$/);
  });

  it('formats a negative offset with a - sign', () => {
    expect(createTimestamp(-5)).toMatch(/-05:00$/);
  });

  it('returns a well-formed RFC 3339 timestamp regardless of offset sign', () => {
    expect(createTimestamp(3)).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:00$/,
    );
    expect(createTimestamp(-3)).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:00$/,
    );
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
