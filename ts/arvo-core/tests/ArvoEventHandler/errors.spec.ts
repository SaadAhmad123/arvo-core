import { describe, expect, it } from 'vitest';
import { ArvoEventHandlerValidationError } from '../../src/ArvoEventHandler/errors.js';
import { ErrorIssue } from '../../src/utils/error-issue.js';

const issue = (path: string, message: string, blockingReason?: string) =>
  new ErrorIssue({ path, message, blockingReason });

describe('ArvoEventHandlerValidationError', () => {
  it('is an Error, so it can be thrown and caught as one', () => {
    expect(new ArvoEventHandlerValidationError([])).toBeInstanceOf(Error);
  });

  it('identifies itself without an instanceof check', () => {
    const error = new ArvoEventHandlerValidationError([]);
    expect(error._tag).toBe('ArvoEventHandlerValidationError');
    expect(error.name).toBe('ArvoEventHandlerValidationError');
  });

  it('names every rule broken in its message, not just the first', () => {
    const error = new ArvoEventHandlerValidationError([
      issue('contract', 'one'),
      issue('services["a"]', 'two'),
    ]);
    expect(error.message).toContain('one');
    expect(error.message).toContain('two');
  });

  it('says what was being built', () => {
    expect(new ArvoEventHandlerValidationError([]).message).toContain(
      'ArvoEventHandler is not valid.',
    );
  });

  it('carries the issues individually as well as in the message', () => {
    const issues = [issue('contract', 'one')];
    expect(new ArvoEventHandlerValidationError(issues).issues).toHaveLength(1);
  });

  it('copies the issues, so a caller mutating the array cannot change it', () => {
    const issues = [issue('contract', 'one')];
    const error = new ArvoEventHandlerValidationError(issues);
    issues.push(issue('services', 'two'));
    expect(error.issues).toHaveLength(1);
  });

  it('freezes what it carries', () => {
    expect(
      Object.isFrozen(new ArvoEventHandlerValidationError([]).issues),
    ).toBe(true);
  });

  it('keeps an underlying cause where one is given', () => {
    const cause = new Error('underlying');
    expect(new ArvoEventHandlerValidationError([], { cause }).cause).toBe(
      cause,
    );
  });

  it('says the list is partial where an issue blocked the rest', () => {
    const error = new ArvoEventHandlerValidationError([
      issue('contract', 'must be an ArvoContract', 'everything reads it'),
    ]);
    expect(error.message).toContain('everything reads it');
  });
});
