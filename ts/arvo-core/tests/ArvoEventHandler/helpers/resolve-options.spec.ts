import { describe, expect, it } from 'vitest';
import { ArvoDomain } from '../../../src/ArvoDomain/index.js';
import { DEFAULT_OPTIONS } from '../../../src/ArvoEventHandler/helpers/defaults.js';
import { resolveOptions } from '../../../src/ArvoEventHandler/helpers/resolve-options.js';

describe('the seven defaults', () => {
  it('are the values ADR-006 fixes', () => {
    expect(DEFAULT_OPTIONS).toEqual({
      maxDepth: 10_000,
      maxRetryAttempts: 3,
      retryDelay: 300,
      runTimeout: 30_000,
      executionTimeout: null,
      collect: 'all',
      handlerErrorDomain: ArvoDomain.LOCAL,
    });
  });

  it('cannot be mutated', () => {
    expect(Object.isFrozen(DEFAULT_OPTIONS)).toBe(true);
  });
});

describe('resolveOptions', () => {
  it('takes every fallback value where nothing was declared', () => {
    expect(resolveOptions(null, DEFAULT_OPTIONS)).toEqual(DEFAULT_OPTIONS);
  });

  it('keeps a declared value and inherits the rest', () => {
    const resolved = resolveOptions({ maxDepth: 250 }, DEFAULT_OPTIONS);
    expect(resolved.maxDepth).toBe(250);
    expect(resolved.maxRetryAttempts).toBe(DEFAULT_OPTIONS.maxRetryAttempts);
  });

  it('inherits an option written as undefined, exactly as an absent one', () => {
    expect(
      resolveOptions({ maxDepth: undefined }, DEFAULT_OPTIONS).maxDepth,
    ).toBe(DEFAULT_OPTIONS.maxDepth);
  });

  it('keeps a written null, which is a value and not an omission', () => {
    expect(
      resolveOptions({ runTimeout: null }, DEFAULT_OPTIONS).runTimeout,
    ).toBeNull();
  });

  it('resolves a version against the handler rather than the protocol', () => {
    const handler = resolveOptions({ runTimeout: 10_000 }, DEFAULT_OPTIONS);
    const version = resolveOptions({ maxDepth: 250 }, handler);
    expect(version.runTimeout).toBe(10_000);
    expect(version.maxDepth).toBe(250);
    expect(version.collect).toBe('all');
  });

  it('lets a version be unbounded where its handler is not', () => {
    const handler = resolveOptions({ runTimeout: 10_000 }, DEFAULT_OPTIONS);
    expect(resolveOptions({ runTimeout: null }, handler).runTimeout).toBeNull();
  });

  it('carries a retry delay given as a function through unchanged', () => {
    const retryDelay = () => 1;
    expect(resolveOptions({ retryDelay }, DEFAULT_OPTIONS).retryDelay).toBe(
      retryDelay,
    );
  });

  it('returns something frozen, so a resolved set cannot be edited later', () => {
    expect(Object.isFrozen(resolveOptions(null, DEFAULT_OPTIONS))).toBe(true);
  });
});
