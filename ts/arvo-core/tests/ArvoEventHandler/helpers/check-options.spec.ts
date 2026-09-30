import { describe, expect, it } from 'vitest';
import { ArvoDomain } from '../../../src/ArvoDomain/index.js';
import { checkOptions } from '../../../src/ArvoEventHandler/helpers/check-options.js';
import type { ArvoEventHandlerOptions } from '../../../src/ArvoEventHandler/types/options.js';

const check = (declared: Partial<ArvoEventHandlerOptions>) =>
  checkOptions(declared, 'options');

const messageFor = (declared: Partial<ArvoEventHandlerOptions>) =>
  check(declared)[0]?.message;

describe('checkOptions', () => {
  it('reports nothing where nothing was declared', () => {
    expect(checkOptions(null, 'options')).toEqual([]);
  });

  it('reports nothing where every declared value is accepted', () => {
    expect(
      check({
        maxDepth: 0,
        maxRetryAttempts: 0,
        retryDelay: 0,
        runTimeout: 1,
        executionTimeout: null,
        collect: 'each',
        handlerErrorDomain: 'orders_failures',
      }),
    ).toEqual([]);
  });

  it('reports every failure rather than the first', () => {
    const issues = check({
      maxDepth: -1,
      maxRetryAttempts: 1.5,
      collect: 'sometimes' as never,
    });
    expect(issues).toHaveLength(3);
  });

  it('names the option in the path, under the path it was given', () => {
    expect(
      checkOptions({ maxDepth: -1 }, 'versions["1.0.0"].options')[0]?.path,
    ).toBe('versions["1.0.0"].options.maxDepth');
  });

  it('carries the offending value', () => {
    expect(check({ maxDepth: -1 })[0]?.received).toBe(-1);
  });

  it('reports no issue as blocking, so every rule still runs', () => {
    expect(check({ maxDepth: -1 })[0]?.isBlocking).toBe(false);
  });

  describe('counts', () => {
    it.each([
      ['maxDepth', -1],
      ['maxDepth', 1.5],
      ['maxDepth', '10'],
      ['maxRetryAttempts', -1],
      ['maxRetryAttempts', Number.NaN],
    ])('rejects %s of %o', (key, value) => {
      expect(check({ [key]: value } as never)).toHaveLength(1);
    });

    it.each([
      ['maxDepth', 0],
      ['maxDepth', 10_000],
      ['maxRetryAttempts', 0],
    ])('accepts %s of %o', (key, value) => {
      expect(check({ [key]: value } as never)).toEqual([]);
    });
  });

  describe('retryDelay', () => {
    it('accepts a non-negative integer', () => {
      expect(check({ retryDelay: 0 })).toEqual([]);
    });

    it('accepts a function', () => {
      expect(check({ retryDelay: () => 1 })).toEqual([]);
    });

    it('rejects a negative number', () => {
      expect(messageFor({ retryDelay: -1 })).toContain('non-negative integer');
    });

    it('rejects a string', () => {
      expect(check({ retryDelay: '300' as never })).toHaveLength(1);
    });
  });

  describe('the two timeouts', () => {
    it.each(['runTimeout', 'executionTimeout'] as const)(
      '%s accepts null for unbounded',
      (key) => {
        expect(check({ [key]: null })).toEqual([]);
      },
    );

    it.each(['runTimeout', 'executionTimeout'] as const)(
      '%s rejects zero, a bound of no time being no bound at all',
      (key) => {
        expect(check({ [key]: 0 })).toHaveLength(1);
      },
    );

    it.each(['runTimeout', 'executionTimeout'] as const)(
      '%s rejects a negative duration',
      (key) => {
        expect(check({ [key]: -1 })).toHaveLength(1);
      },
    );

    it('rejects a non-integer duration', () => {
      expect(check({ runTimeout: 1.5 })).toHaveLength(1);
    });
  });

  describe('collect', () => {
    it.each(['all', 'each'] as const)('accepts %s', (value) => {
      expect(check({ collect: value })).toEqual([]);
    });

    it('rejects anything else, naming both allowed values', () => {
      expect(messageFor({ collect: 'both' as never })).toBe(
        "must be 'all' or 'each'",
      );
    });
  });

  describe('handlerErrorDomain', () => {
    it('accepts a non-empty literal', () => {
      expect(check({ handlerErrorDomain: 'orders' })).toEqual([]);
    });

    it.each(Object.entries(ArvoDomain))(
      'accepts the %s source',
      (_name, symbol) => {
        expect(check({ handlerErrorDomain: symbol })).toEqual([]);
      },
    );

    it('rejects an empty literal', () => {
      expect(check({ handlerErrorDomain: '' })).toHaveLength(1);
    });

    it('rejects a symbol that is not one of the four sources', () => {
      expect(
        check({ handlerErrorDomain: Symbol('elsewhere') as any }),
      ).toHaveLength(1);
    });

    it('rejects a value that is neither', () => {
      expect(check({ handlerErrorDomain: 1 as never })).toHaveLength(1);
    });
  });
});
