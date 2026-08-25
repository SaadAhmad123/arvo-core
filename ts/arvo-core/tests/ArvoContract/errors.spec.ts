import { describe, expect, it } from 'vitest';
import { ArvoContractValidationError } from '../../src/ArvoContract/errors.js';
import { ErrorIssue } from '../../src/utils/error-issue.js';

describe('ArvoContractValidationError', () => {
  it('carries a discriminant and a name', () => {
    const error = new ArvoContractValidationError([
      new ErrorIssue({ path: 'type', message: 'must be lowercase' }),
    ]);
    expect(error).toBeInstanceOf(Error);
    expect(error._tag).toBe('ArvoContractValidationError');
    expect(error.name).toBe('ArvoContractValidationError');
  });

  it('names one problem under a singular preamble', () => {
    expect(
      new ArvoContractValidationError([
        new ErrorIssue({ path: 'type', message: 'must be lowercase' }),
      ]).message,
    ).toBe(
      [
        'ArvoContract is not valid.',
        'The following problem was found:',
        '  - type: must be lowercase',
      ].join('\n'),
    );
  });

  it('names every problem when there are several', () => {
    const message = new ArvoContractValidationError([
      new ErrorIssue({ path: 'type', message: 'must be lowercase' }),
      new ErrorIssue({ path: 'uri', message: 'must be canonical' }),
    ]).message;
    expect(message).toContain('The following 2 problems were found:');
    expect(message).toContain('  - type: must be lowercase');
    expect(message).toContain('  - uri: must be canonical');
  });

  it('is the heading alone when constructed with no issues', () => {
    expect(new ArvoContractValidationError([]).message).toBe(
      'ArvoContract is not valid.',
    );
  });

  it('freezes issues', () => {
    const { issues } = new ArvoContractValidationError([
      new ErrorIssue({ path: 'type', message: 'must be lowercase' }),
    ]);
    expect(Object.isFrozen(issues)).toBe(true);
  });

  it('preserves a cause when given one', () => {
    const cause = new Error('underlying');
    expect(new ArvoContractValidationError([], { cause }).cause).toBe(cause);
  });
});
