import { describe, expect, it } from 'vitest';
import { createTimestamp } from '../src/utils.js';

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
