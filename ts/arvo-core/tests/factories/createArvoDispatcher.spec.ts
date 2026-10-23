import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArvoDispatcherValidationError } from '../../src/ArvoDispatcher/errors.js';
import { ArvoDispatcher } from '../../src/ArvoDispatcher/index.js';
import {
  createArvoDispatcher,
  tryCreateArvoDispatcher,
} from '../../src/factories/createArvoDispatcher.js';
import * as packageEntry from '../../src/index.js';
import { orderHandler, paymentHandler } from '../ArvoDispatcher/fixtures.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('declaring a dispatcher, as a pair', () => {
  it('returns the dispatcher from the primitive', () => {
    const declared = tryCreateArvoDispatcher({
      handlers: [orderHandler(), paymentHandler()],
    });
    expect(declared.ok && declared.value).toBeInstanceOf(ArvoDispatcher);
  });

  it('reports an invalid declaration as the dispatcher’s validation error', () => {
    const declared = tryCreateArvoDispatcher({ handlers: [] });
    expect(declared.ok).toBe(false);
    if (declared.ok) return;
    expect(declared.error).toBeInstanceOf(ArvoDispatcherValidationError);
  });

  it('lets anything else thrown go up as it arrived', () => {
    const failure = new Error('a bug while flattening');
    const handlers = [orderHandler()];
    vi.spyOn(handlers, 'forEach').mockImplementation(() => {
      throw failure;
    });
    expect(() => tryCreateArvoDispatcher({ handlers })).toThrow(failure);
  });

  it('returns the dispatcher from the throwing form', () => {
    expect(createArvoDispatcher({ handlers: [orderHandler()] })).toBeInstanceOf(
      ArvoDispatcher,
    );
  });

  it('throws from the throwing form what the primitive reported', () => {
    const declared = tryCreateArvoDispatcher({ handlers: [] });
    if (declared.ok) throw new Error('expected a refusal');
    expect(() => createArvoDispatcher({ handlers: [] })).toThrow(
      declared.error.message,
    );
  });
});

describe('the package entry', () => {
  it('exports the dispatcher, its factories and its error', () => {
    expect(packageEntry.ArvoDispatcher).toBe(ArvoDispatcher);
    expect(packageEntry.createArvoDispatcher).toBe(createArvoDispatcher);
    expect(packageEntry.tryCreateArvoDispatcher).toBe(tryCreateArvoDispatcher);
    expect(packageEntry.ArvoDispatcherValidationError).toBe(
      ArvoDispatcherValidationError,
    );
  });
});
