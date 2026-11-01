import { describe, expect, it } from 'vitest';
import { ArvoSqliteOutboxValidationError } from '../../../src/outbox/sqlite/errors.js';
import { ErrorIssue } from '../../../src/utils/error-issue.js';

describe('a SQLite outbox validation error', () => {
  const issues = [
    new ErrorIssue({
      path: 'options.busyTimeoutMs',
      message: 'Too small: expected number to be >=0',
      received: -1,
    }),
    new ErrorIssue({
      path: 'options.retentionMs.seenEvents',
      message: 'Invalid input',
      received: 1.5,
    }),
  ];

  it('names every problem in the options', () => {
    const error = new ArvoSqliteOutboxValidationError(issues);
    expect(error.message).toContain(
      'ArvoSqliteOutbox cannot be built with these options.',
    );
    expect(error.message).toContain('options.busyTimeoutMs');
    expect(error.message).toContain('options.retentionMs.seenEvents');
  });

  it('carries a frozen copy of every issue', () => {
    const issuesToMutate = [...issues];
    const error = new ArvoSqliteOutboxValidationError(issuesToMutate);
    issuesToMutate.pop();
    expect(error.issues).toEqual(issues);
    expect(Object.isFrozen(error.issues)).toBe(true);
  });

  it('is an Error, told apart by its tag and its name', () => {
    const error = new ArvoSqliteOutboxValidationError(issues);
    expect(error).toBeInstanceOf(Error);
    expect(error._tag).toBe('ArvoSqliteOutboxValidationError');
    expect(error.name).toBe('ArvoSqliteOutboxValidationError');
  });
});
