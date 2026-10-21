import { describe, expect, it, vi } from 'vitest';
import {
  ArvoComposedMiddlewareResolutionError,
  ArvoComposedMiddlewareValidationError,
} from '../../../../src/ArvoEventHandler/version/composed-middleware/errors.js';
import { tryCreateArvoComposedMiddleware } from '../../../../src/ArvoEventHandler/version/composed-middleware/factory.js';
import { ArvoComposedMiddleware } from '../../../../src/ArvoEventHandler/version/composed-middleware/index.js';

const createFrom = (supplied: unknown, declared: unknown) =>
  tryCreateArvoComposedMiddleware({
    // deliberately untyped: these lists exercise the factory's own checks
    supplied: supplied as never,
    declared: declared as never,
    abortSignal: new AbortController().signal,
  });

describe('layers that are fine', () => {
  it('come back as the composite', async () => {
    const attempt = await createFrom(
      [{ id: 'tenant' }],
      [() => ({ id: 'audit' })],
    );
    expect(attempt.ok && attempt.value).toBeInstanceOf(ArvoComposedMiddleware);
  });

  it('may be omitted on either side, read as none', async () => {
    for (const omitted of [null, undefined]) {
      const attempt = await createFrom(omitted, omitted);
      expect(attempt.ok).toBe(true);
    }
  });
});

describe('a side that is not a list', () => {
  it('is refused before anything is made, as a failed instantiation', async () => {
    const declaredMaker = vi.fn(() => ({ id: 'audit' }));
    const attempt = await createFrom({ id: 'tenant' }, [declaredMaker]);
    expect(attempt.ok).toBe(false);
    if (attempt.ok) return;
    expect(attempt.error).toBeInstanceOf(ArvoComposedMiddlewareValidationError);
    expect(attempt.error.faultKind).toBe('middleware_instantiation_failed');
    expect(declaredMaker).not.toHaveBeenCalled();
  });

  it('is named for each side that is not a list, in one refusal', async () => {
    const attempt = await createFrom('text', 42);
    const issuePaths =
      !attempt.ok &&
      attempt.error instanceof ArvoComposedMiddlewareValidationError
        ? attempt.error.issues.map((issue) => issue.path)
        : [];
    expect(issuePaths).toEqual([
      'execute({ middleware })',
      'setupArvoEventHandler({ middleware })',
    ]);
  });
});

describe('a way to make a layer that throws', () => {
  it('comes back as the resolution error, the layers never judged', async () => {
    const attempt = await createFrom(
      [
        42, // not a layer: would be refused, were the layers ever judged
        () => {
          throw new Error('pool exhausted');
        },
      ],
      [],
    );
    expect(!attempt.ok && attempt.error).toBeInstanceOf(
      ArvoComposedMiddlewareResolutionError,
    );
  });
});

describe('layers that break a rule', () => {
  it('come back as the validation error', async () => {
    const attempt = await createFrom([{ id: 'same' }], [{ id: 'same' }]);
    expect(!attempt.ok && attempt.error).toBeInstanceOf(
      ArvoComposedMiddlewareValidationError,
    );
    expect(!attempt.ok && attempt.error.faultKind).toBe('middleware_conflict');
  });
});

describe('a layer whose id cannot be read', () => {
  it('is refused, not thrown', async () => {
    const unreadableLayer = {
      get id(): string {
        throw new Error('id could not be read');
      },
    };
    const attempt = await createFrom([unreadableLayer], []);
    expect(!attempt.ok && attempt.error).toBeInstanceOf(
      ArvoComposedMiddlewareValidationError,
    );
  });
});

describe('anything else thrown while building the composite', () => {
  it('goes up as it was thrown, not as a refusal', async () => {
    const readFailure = new Error('the signal could not be read');
    const hostileParam = {
      supplied: [],
      declared: [],
      get abortSignal(): AbortSignal {
        throw readFailure;
      },
    };
    await expect(tryCreateArvoComposedMiddleware(hostileParam)).rejects.toBe(
      readFailure,
    );
  });
});

describe('a way to make a layer that makes something else', () => {
  it.each([
    ['nothing', undefined],
    ['null', null],
    ['an object with no id', {}],
    ['an id that is not a string', { id: 1 }],
    ['a before that is not a function', { id: 'x', before: 'soon' }],
  ])('is refused where it makes %s', async (_label, madeValue) => {
    const attempt = await createFrom([], [() => madeValue]);
    expect(!attempt.ok && attempt.error).toBeInstanceOf(
      ArvoComposedMiddlewareValidationError,
    );
    expect(!attempt.ok && attempt.error.faultKind).toBe(
      'middleware_instantiation_failed',
    );
  });

  it('is refused as a conflict where what it makes repeats another id', async () => {
    const attempt = await createFrom(
      [{ id: 'audit' }],
      [() => ({ id: 'audit' })],
    );
    expect(!attempt.ok && attempt.error.faultKind).toBe('middleware_conflict');
  });
});

describe('one instance supplied twice', () => {
  it('is refused as a conflict', async () => {
    const sameLayer = { id: 'same' };
    const attempt = await createFrom([sameLayer, sameLayer], []);
    expect(!attempt.ok && attempt.error.faultKind).toBe('middleware_conflict');
  });
});
