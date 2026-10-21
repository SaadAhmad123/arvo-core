import { describe, expect, it } from 'vitest';
import {
  ArvoComposedMiddlewareResolutionError,
  ArvoComposedMiddlewareValidationError,
} from '../../../src/ArvoEventHandler/version/composed-middleware/errors.js';
import { refusalFrom } from '../../../src/ArvoEventHandler/version/middleware-refusal.js';
import { ErrorIssue } from '../../../src/utils/error-issue.js';

describe('a validation error as a refusal', () => {
  const conflictError = new ArvoComposedMiddlewareValidationError(
    'middleware_conflict',
    'This execution was not run: two or more of its middleware share an id.',
    [
      new ErrorIssue({
        path: 'execute({ middleware })[1].id',
        message: 'repeats "a"',
      }),
      new ErrorIssue({
        path: 'execute({ middleware })[2].id',
        message: 'repeats "b"',
      }),
    ],
  );

  it('keeps its fault kind and its message', () => {
    expect(refusalFrom(conflictError)).toMatchObject({
      faultKind: 'middleware_conflict',
      message: conflictError.message,
    });
  });

  it('carries every issue as a violation', () => {
    expect(refusalFrom(conflictError).violations).toEqual([
      'execute({ middleware })[1].id: repeats "a"',
      'execute({ middleware })[2].id: repeats "b"',
    ]);
  });

  it('carries no cause and leaves retrying to the fault kind', () => {
    const refusal = refusalFrom(conflictError);
    expect(refusal.cause).toBeUndefined();
    expect(refusal.retryable).toBeUndefined();
  });
});

describe('a resolution error as a refusal', () => {
  const resolutionError = new ArvoComposedMiddlewareResolutionError({
    position: 'execute({ middleware })[0]',
    thrown: new Error('no database connection'),
  });

  it('is a failed instantiation, with its message', () => {
    expect(refusalFrom(resolutionError)).toMatchObject({
      faultKind: 'middleware_instantiation_failed',
      message: resolutionError.message,
    });
  });

  it('names the position and what was thrown, as the violation and the cause', () => {
    const refusal = refusalFrom(resolutionError);
    expect(refusal.violations).toEqual([
      'execute({ middleware })[0]: no database connection',
    ]);
    expect(refusal.cause).toBe('no database connection');
  });

  it('renders a thrown value that is not an Error', () => {
    const refusal = refusalFrom(
      new ArvoComposedMiddlewareResolutionError({
        position: 'execute({ middleware })[0]',
        thrown: 'no tenant',
      }),
    );
    expect(refusal.cause).toBe('no tenant');
  });
});
