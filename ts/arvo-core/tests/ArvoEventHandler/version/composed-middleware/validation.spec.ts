import { describe, expect, it } from 'vitest';
import { ArvoComposedMiddlewareValidationError } from '../../../../src/ArvoEventHandler/version/composed-middleware/errors.js';
import { composeEntries } from './fixture.js';

/** What the constructor threw, or `null` where it built the composite. */
const constructorRefusal = (
  entries: Parameters<typeof composeEntries>[0],
): ArvoComposedMiddlewareValidationError | null => {
  try {
    composeEntries(entries);
    return null;
  } catch (error_) {
    if (error_ instanceof ArvoComposedMiddlewareValidationError) return error_;
    throw error_;
  }
};

const issuePaths = (refusal: ArvoComposedMiddlewareValidationError | null) =>
  refusal?.issues.map((issue) => issue.path);

describe('layers that break no rule', () => {
  it('build the composite', () => {
    expect(
      constructorRefusal({
        supplied: [{ id: 'tenant' }],
        declared: [{ id: 'audit', after: () => undefined }],
      }),
    ).toBeNull();
  });

  it('build it from nothing at all', () => {
    expect(constructorRefusal({ supplied: [], declared: [] })).toBeNull();
  });
});

describe('the shape pass', () => {
  it('names every entry that is not a layer, supplied and declared, in one refusal', () => {
    const refusal = constructorRefusal({
      supplied: [{ id: 'fine' }, 42],
      declared: [null, { id: 'also_fine' }, 'text'],
    });
    expect(refusal?.faultKind).toBe('middleware_instantiation_failed');
    expect(issuePaths(refusal)).toEqual([
      'execute({ middleware })[1]',
      'setupArvoEventHandler({ middleware })[0]',
      'setupArvoEventHandler({ middleware })[2]',
    ]);
  });

  it('names every thing wrong with one entry', () => {
    const refusal = constructorRefusal({
      supplied: [{ id: 7, before: 'soon', after: 3 }],
      declared: [],
    });
    expect(issuePaths(refusal)).toEqual([
      'execute({ middleware })[0]',
      'execute({ middleware })[0].before',
      'execute({ middleware })[0].after',
    ]);
  });

  it('marks each issue as blocking, because identifiers are not yet comparable', () => {
    const refusal = constructorRefusal({ supplied: [42], declared: [] });
    expect(refusal?.issues.every((issue) => issue.isBlocking)).toBe(true);
    expect(refusal?.message).toContain('This is not the whole list');
  });

  it('runs no identifier check while any entry is not a layer', () => {
    const refusal = constructorRefusal({
      supplied: [{ id: 'same' }, { id: 'same' }],
      declared: [42],
    });
    expect(refusal?.faultKind).toBe('middleware_instantiation_failed');
    expect(issuePaths(refusal)).toEqual([
      'setupArvoEventHandler({ middleware })[0]',
    ]);
  });
});

describe('the identifier pass', () => {
  it('names every repeated identifier in one refusal, each with both positions', () => {
    const refusal = constructorRefusal({
      supplied: [{ id: 'tenant' }, { id: 'audit' }],
      declared: [{ id: 'tenant' }, { id: 'audit' }, { id: 'clock' }],
    });
    expect(refusal?.faultKind).toBe('middleware_conflict');
    expect(issuePaths(refusal)).toEqual([
      'setupArvoEventHandler({ middleware })[0].id',
      'setupArvoEventHandler({ middleware })[1].id',
    ]);
    expect(refusal?.issues[0]?.message).toContain('"tenant"');
    expect(refusal?.issues[0]?.message).toContain('execute({ middleware })[0]');
    expect(refusal?.issues[1]?.message).toContain('execute({ middleware })[1]');
  });

  it('names a repeat within one list against its first position', () => {
    const refusal = constructorRefusal({
      supplied: [],
      declared: [{ id: 'audit' }, { id: 'audit' }, { id: 'audit' }],
    });
    expect(issuePaths(refusal)).toEqual([
      'setupArvoEventHandler({ middleware })[1].id',
      'setupArvoEventHandler({ middleware })[2].id',
    ]);
    expect(
      refusal?.issues.every((issue) =>
        issue.message.includes('setupArvoEventHandler({ middleware })[0]'),
      ),
    ).toBe(true);
  });

  it('marks no conflict as blocking: every one was checked', () => {
    const refusal = constructorRefusal({
      supplied: [{ id: 'same' }],
      declared: [{ id: 'same' }],
    });
    expect(refusal?.issues.some((issue) => issue.isBlocking)).toBe(false);
  });
});
