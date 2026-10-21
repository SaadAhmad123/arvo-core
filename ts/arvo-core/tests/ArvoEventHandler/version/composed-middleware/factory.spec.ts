import { describe, expect, it, vi } from 'vitest';
import {
  ArvoComposedMiddlewareResolutionError,
  ArvoComposedMiddlewareValidationError,
} from '../../../../src/ArvoEventHandler/version/composed-middleware/errors.js';
import { tryCreateArvoComposedMiddleware } from '../../../../src/ArvoEventHandler/version/composed-middleware/factory.js';
import { ArvoComposedMiddleware } from '../../../../src/ArvoEventHandler/version/composed-middleware/index.js';

const createFrom = (supplied: unknown, declared: unknown) =>
  tryCreateArvoComposedMiddleware({
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

describe('anything else the constructor throws', () => {
  it('goes up as it was thrown, not as a refusal', async () => {
    const readFailure = new Error('id could not be read');
    const unreadableLayer = {
      get id(): string {
        throw readFailure;
      },
    };
    await expect(createFrom([unreadableLayer], [])).rejects.toBe(readFailure);
  });
});
