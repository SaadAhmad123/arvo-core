import { describe, expect, it } from 'vitest';
import { ArvoMemoryOutboxValidationError } from '../../../src/outbox/inmemory/errors.js';
import { ErrorIssue } from '../../../src/utils/error-issue.js';

describe('an in-memory outbox validation error', () => {
  const issues = [
    new ErrorIssue({
      path: 'options.buffers.events.size',
      message: 'Too small: expected number to be >0',
      received: 0,
    }),
    new ErrorIssue({
      path: 'options.retentionMs.seenEvents',
      message: 'Invalid input: expected int, received number',
      received: 1.5,
    }),
  ];

  it('names every problem in the options', () => {
    const error = new ArvoMemoryOutboxValidationError(issues);
    expect(error.message).toContain(
      'ArvoMemoryOutbox cannot be built with these options.',
    );
    expect(error.message).toContain('options.buffers.events.size');
    expect(error.message).toContain('options.retentionMs.seenEvents');
  });

  it('carries a frozen copy of every issue', () => {
    const given = [...issues];
    const error = new ArvoMemoryOutboxValidationError(given);
    given.pop();
    expect(error.issues).toEqual(issues);
    expect(Object.isFrozen(error.issues)).toBe(true);
  });

  it('is an Error, told apart by its tag and its name', () => {
    const error = new ArvoMemoryOutboxValidationError(issues);
    expect(error).toBeInstanceOf(Error);
    expect(error._tag).toBe('ArvoMemoryOutboxValidationError');
    expect(error.name).toBe('ArvoMemoryOutboxValidationError');
  });
});
