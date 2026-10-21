import { describe, expect, it } from 'vitest';
import { ArvoDomain } from '../../../src/ArvoDomain/index.js';
import { checkOptions } from '../../../src/ArvoEventHandler/helpers/check-options.js';
import type { ArvoEventHandlerOptions } from '../../../src/ArvoEventHandler/types/options.js';

/** What a rejection says, flattened to what a reader would check. */
const refusedPaths = (
  declaredOptions: Partial<ArvoEventHandlerOptions> | null,
  path = 'options',
) => checkOptions(declaredOptions, path).map((issue) => issue.path);

describe('what passes', () => {
  it('nothing declared at all', () => {
    expect(checkOptions(null, 'options')).toEqual([]);
    expect(checkOptions({}, 'options')).toEqual([]);
  });

  it('every option at a value its type admits', () => {
    expect(
      checkOptions(
        {
          maxDepth: 0,
          maxRetryAttempts: 0,
          retryDelay: 0,
          runTimeout: 1,
          executionTimeout: 1,
          collect: 'each',
          handlerErrorDomain: 'order_failures',
        },
        'options',
      ),
    ).toEqual([]);
  });

  it('a retry delay worked out per attempt', () => {
    expect(
      refusedPaths({ retryDelay: (_event, _state, attempt) => attempt * 100 }),
    ).toEqual([]);
  });

  it('either clock written null, null being unbounded', () => {
    expect(refusedPaths({ runTimeout: null, executionTimeout: null })).toEqual(
      [],
    );
  });

  it('a domain named as a source to read one from', () => {
    expect(
      refusedPaths({ handlerErrorDomain: ArvoDomain.FROM_TRIGGERING_EVENT }),
    ).toEqual([]);
  });

  it('a domain written null, which asks for no domain', () => {
    expect(refusedPaths({ handlerErrorDomain: null })).toEqual([]);
  });
});

describe('each option is judged on its own domain', () => {
  it('refuses a depth below zero, and one that is not whole', () => {
    expect(refusedPaths({ maxDepth: -1 })).toEqual(['options.maxDepth']);
    expect(refusedPaths({ maxDepth: 1.5 })).toEqual(['options.maxDepth']);
  });

  it('refuses an attempt count below zero, and one that is not whole', () => {
    expect(refusedPaths({ maxRetryAttempts: -1 })).toEqual([
      'options.maxRetryAttempts',
    ]);
    expect(refusedPaths({ maxRetryAttempts: 2.5 })).toEqual([
      'options.maxRetryAttempts',
    ]);
  });

  it('refuses a retry delay below zero, and one that is neither a count nor a function', () => {
    expect(refusedPaths({ retryDelay: -1 })).toEqual(['options.retryDelay']);
    expect(refusedPaths({ retryDelay: 'soon' as unknown as number })).toEqual([
      'options.retryDelay',
    ]);
  });

  it('refuses a run clock at zero, since no attempt fits in no time', () => {
    expect(refusedPaths({ runTimeout: 0 })).toEqual(['options.runTimeout']);
    expect(refusedPaths({ runTimeout: -1 })).toEqual(['options.runTimeout']);
  });

  it('refuses an execution clock at zero', () => {
    expect(refusedPaths({ executionTimeout: 0 })).toEqual([
      'options.executionTimeout',
    ]);
  });

  it('refuses a join it does not offer', () => {
    expect(refusedPaths({ collect: 'some' as unknown as 'all' })).toEqual([
      'options.collect',
    ]);
  });

  it('refuses a domain that is neither a literal, a source, nor none', () => {
    expect(
      refusedPaths({ handlerErrorDomain: 7 as unknown as string }),
    ).toEqual(['options.handlerErrorDomain']);
  });

  it('refuses an empty domain, which names nothing', () => {
    expect(refusedPaths({ handlerErrorDomain: '  ' })).toEqual([
      'options.handlerErrorDomain',
    ]);
  });

  it('refuses a count that is not a number at all', () => {
    expect(refusedPaths({ maxDepth: Number.NaN })).toEqual([
      'options.maxDepth',
    ]);
  });
});

describe('what a rejection tells the reader', () => {
  it('names where it is, so a version is distinguishable from the handler', () => {
    const [issue] = checkOptions({ maxDepth: -1 }, 'versions.1.0.0.options');
    expect(issue?.path).toBe('versions.1.0.0.options.maxDepth');
  });

  it('shows the value that was written', () => {
    const [issue] = checkOptions({ maxDepth: -1 }, 'options');
    expect(issue?.received).toBe(-1);
  });

  it('says what the option accepts rather than that a check failed', () => {
    const [issue] = checkOptions({ collect: 'some' as 'all' }, 'options');
    expect(issue?.message).toContain('all');
    expect(issue?.message).toContain('each');
  });

  it('reports every option that is wrong, not only the first', () => {
    expect(
      refusedPaths({ maxDepth: -1, runTimeout: 0, collect: 'some' as 'all' }),
    ).toEqual(['options.maxDepth', 'options.runTimeout', 'options.collect']);
  });

  it('judges what was written and says nothing about what was not', () => {
    expect(refusedPaths({ maxDepth: 5 })).toEqual([]);
  });

  it('reads an option written undefined as one never written', () => {
    expect(refusedPaths({ maxDepth: undefined })).toEqual([]);
  });
});
