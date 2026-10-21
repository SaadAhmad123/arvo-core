import { describe, expect, it } from 'vitest';
import {
  ArvoComposedMiddlewareResolutionError,
  ArvoComposedMiddlewareValidationError,
} from '../../../../src/ArvoEventHandler/version/composed-middleware/errors.js';
import { ErrorIssue } from '../../../../src/utils/error-issue.js';

const errorIssue = (path: string, message: string, blockingReason?: string) =>
  new ErrorIssue({ path, message, blockingReason });

describe('the validation error', () => {
  const twoBadEntries = () =>
    new ArvoComposedMiddlewareValidationError(
      'middleware_instantiation_failed',
      'The layers for this execution are not valid, so no layer ran.',
      [
        errorIssue('execute({ middleware })[0]', 'is not a layer'),
        errorIssue(
          'setupArvoEventHandler({ middleware })[2]',
          'is not a layer',
        ),
      ],
    );

  it('carries the fault it becomes', () => {
    expect(twoBadEntries().faultKind).toBe('middleware_instantiation_failed');
    expect(
      new ArvoComposedMiddlewareValidationError('middleware_conflict', 'x', [])
        .faultKind,
    ).toBe('middleware_conflict');
  });

  it('carries every issue it was given', () => {
    expect(twoBadEntries().issues.map((issue) => issue.path)).toEqual([
      'execute({ middleware })[0]',
      'setupArvoEventHandler({ middleware })[2]',
    ]);
  });

  it('names every issue in its message, under its heading', () => {
    const { message } = twoBadEntries();
    expect(message).toContain('The layers for this execution are not valid');
    expect(message).toContain('execute({ middleware })[0]');
    expect(message).toContain('setupArvoEventHandler({ middleware })[2]');
  });

  it('says the list is partial where an issue stopped the rest', () => {
    const blockingValidationError = new ArvoComposedMiddlewareValidationError(
      'middleware_instantiation_failed',
      'heading.',
      [
        errorIssue(
          'execute({ middleware })[0]',
          'is not a layer',
          'identifiers are compared only once every entry is a layer',
        ),
      ],
    );
    expect(blockingValidationError.message).toContain(
      'This is not the whole list',
    );
  });

  it('holds its issues against being written into afterwards', () => {
    expect(() =>
      (twoBadEntries().issues as ErrorIssue[]).push(errorIssue('x', 'y')),
    ).toThrow();
  });

  it('identifies itself without an instanceof check', () => {
    expect(twoBadEntries()._tag).toBe('ArvoComposedMiddlewareValidationError');
    expect(twoBadEntries().name).toBe('ArvoComposedMiddlewareValidationError');
  });

  it('is an Error', () => {
    expect(twoBadEntries()).toBeInstanceOf(Error);
  });
});

describe('the resolution error', () => {
  const factoryFailure = new Error('pool exhausted');
  const factoryResolutionError = () =>
    new ArvoComposedMiddlewareResolutionError({
      position: 'setupArvoEventHandler({ middleware })[1]',
      thrown: factoryFailure,
    });

  it('always becomes a failed instantiation', () => {
    expect(factoryResolutionError().faultKind).toBe(
      'middleware_instantiation_failed',
    );
  });

  it('carries the position of the factory that threw', () => {
    expect(factoryResolutionError().position).toBe(
      'setupArvoEventHandler({ middleware })[1]',
    );
  });

  it('keeps what was thrown as its cause', () => {
    expect(factoryResolutionError().cause).toBe(factoryFailure);
  });

  it('names the position and what was thrown in its message', () => {
    expect(factoryResolutionError().message).toBe(
      'This execution was not run: setupArvoEventHandler({ middleware })[1] is a function that should return a middleware, and calling it threw: pool exhausted. No middleware ran and the handler was not called. Fix the function, or pass the middleware object itself',
    );
  });

  it('renders a thrown value that is not an Error', () => {
    const stringResolutionError = new ArvoComposedMiddlewareResolutionError({
      position: 'execute({ middleware })[0]',
      thrown: 'no tenant',
    });
    expect(stringResolutionError.message).toContain(
      'calling it threw: no tenant.',
    );
    expect(stringResolutionError.cause).toBe('no tenant');
  });

  it('identifies itself without an instanceof check', () => {
    expect(factoryResolutionError()._tag).toBe(
      'ArvoComposedMiddlewareResolutionError',
    );
    expect(factoryResolutionError().name).toBe(
      'ArvoComposedMiddlewareResolutionError',
    );
  });

  it('is an Error', () => {
    expect(factoryResolutionError()).toBeInstanceOf(Error);
  });
});
