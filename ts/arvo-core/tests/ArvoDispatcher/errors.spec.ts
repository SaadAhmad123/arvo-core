import { describe, expect, it } from 'vitest';
import { ArvoDispatcherValidationError } from '../../src/ArvoDispatcher/errors.js';
import { ErrorIssue } from '../../src/utils/error-issue.js';

const issues = [
  new ErrorIssue({
    path: 'handlers',
    message: 'must name at least one handler',
  }),
  new ErrorIssue({ path: 'handlers[1]', message: 'appears twice' }),
];

describe('a dispatcher validation error', () => {
  it('carries every issue it was given', () => {
    expect(new ArvoDispatcherValidationError(issues).issues).toEqual(issues);
  });

  it('freezes its issues, so nothing can change what was reported', () => {
    expect(
      Object.isFrozen(new ArvoDispatcherValidationError(issues).issues),
    ).toBe(true);
  });

  it('copies its issues, so the list it was given stays the caller’s', () => {
    const given = [...issues];
    const error = new ArvoDispatcherValidationError(given);
    given.pop();
    expect(error.issues).toHaveLength(2);
  });

  it('builds its message from every issue', () => {
    const { message } = new ArvoDispatcherValidationError(issues);
    expect(message).toContain('ArvoDispatcher is not valid.');
    expect(message).toContain('must name at least one handler');
    expect(message).toContain('appears twice');
  });

  it('names itself by its tag', () => {
    const error = new ArvoDispatcherValidationError(issues);
    expect(error._tag).toBe('ArvoDispatcherValidationError');
    expect(error.name).toBe('ArvoDispatcherValidationError');
  });

  it('keeps a cause it was given', () => {
    const cause = new Error('underneath');
    expect(new ArvoDispatcherValidationError(issues, { cause }).cause).toBe(
      cause,
    );
  });
});
