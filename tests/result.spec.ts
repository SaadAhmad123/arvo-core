import { err, errAsync, ok, okAsync } from 'neverthrow';
import { describe, expect, it } from 'vitest';
import { fromNeverthrow, fromNeverthrowAsync } from '../src/result.js';

describe('fromNeverthrow', () => {
  it('converts an Ok into { ok: true, value }', () => {
    const result = fromNeverthrow(ok(42));
    expect(result).toEqual({ ok: true, value: 42 });
  });

  it('converts an Err into { ok: false, error }', () => {
    const result = fromNeverthrow(err('bad'));
    expect(result).toEqual({ ok: false, error: 'bad' });
  });

  it('produces a plain object, not a neverthrow instance', () => {
    const result = fromNeverthrow(ok(1));
    expect(result.constructor).toBe(Object);
    expect('isOk' in result).toBe(false);
    expect('isErr' in result).toBe(false);
    expect('match' in result).toBe(false);
    expect('_unsafeUnwrap' in result).toBe(false);
  });

  it('narrows on .ok without any neverthrow method', () => {
    const result = fromNeverthrow(ok('narrowed'));
    if (result.ok) {
      // TypeScript narrows `result.value` here with no library call.
      expect(result.value).toBe('narrowed');
    } else {
      throw new Error('expected ok');
    }
  });
});

describe('fromNeverthrowAsync', () => {
  it('converts an okAsync into { ok: true, value }', async () => {
    const result = await fromNeverthrowAsync(okAsync(99));
    expect(result).toEqual({ ok: true, value: 99 });
  });

  it('converts an errAsync into { ok: false, error }', async () => {
    const result = await fromNeverthrowAsync(errAsync('async-bad'));
    expect(result).toEqual({ ok: false, error: 'async-bad' });
  });

  it('produces a plain object, not a neverthrow instance', async () => {
    const result = await fromNeverthrowAsync(okAsync(1));
    expect(result.constructor).toBe(Object);
    expect('isOk' in result).toBe(false);
  });

  it('returns a genuine Promise, not merely a PromiseLike', () => {
    const pending = fromNeverthrowAsync(okAsync(1));
    expect(pending).toBeInstanceOf(Promise);
    expect(typeof pending.catch).toBe('function');
    expect(typeof pending.finally).toBe('function');
    return pending;
  });
});
