import { describe, expect, it, vi } from 'vitest';
import type { IArvoEventHandlerMiddleware } from '../../../src/ArvoEventHandler/types/middleware.js';
import { executeOrder, orderHandler } from './fixture.js';

/**
 * How an execution refuses middleware it cannot use, as a caller sees it.
 *
 * Every factory in a list is called before anything is checked, and a
 * refusal names every problem it found, in the words of the caller's own
 * code. In every case nothing ran and the fault is not retried.
 */

const faultOf = async (
  supplied: unknown,
  declared: IArvoEventHandlerMiddleware[] = [],
) => {
  const executorSpy = vi.fn();
  const executionResult = await executeOrder(
    orderHandler({ middleware: declared, execute: executorSpy as never }),
    { middleware: supplied as never },
  );
  expect(executorSpy).not.toHaveBeenCalled();
  if (executionResult.ok) throw new Error('the execution was not refused');
  return executionResult.error;
};

describe('an entry that is not a middleware, and a factory after it', () => {
  it('calls the factory, then refuses the entry', async () => {
    const laterFactory = vi.fn(() => ({ id: 'made' }));
    const fault = await faultOf([42, laterFactory]);
    expect(laterFactory).toHaveBeenCalledTimes(1);
    expect(fault.faultKind).toBe('middleware_instantiation_failed');
    expect(fault.message).toContain('execute({ middleware })[0]');
  });
});

describe('an entry that is not a middleware, and a factory after it that throws', () => {
  it('reports the factory that threw', async () => {
    const fault = await faultOf([
      42,
      () => {
        throw new Error('no database connection');
      },
    ]);
    expect(fault.faultKind).toBe('middleware_instantiation_failed');
    expect(fault.message).toContain('execute({ middleware })[1]');
    expect(fault.message).toContain('no database connection');
    expect(fault.retry).toBeNull();
  });
});

describe('a factory that throws, and factories after it in the same list', () => {
  it('still calls the later ones', async () => {
    const laterFactory = vi.fn(() => ({ id: 'made' }));
    await faultOf([
      () => {
        throw new Error('boom');
      },
      laterFactory,
    ]);
    expect(laterFactory).toHaveBeenCalledTimes(1);
  });
});

describe('several entries that are wrong', () => {
  it('names every one of them, supplied and declared, in one refusal', async () => {
    const fault = await faultOf(
      [42, { id: 'fine' }, 'text'],
      // a declared entry is checked when the handler is built; one made
      // per execution is checked only once it is made
      [(() => ({ name: 'no id' })) as never],
    );
    expect(fault.violations).toHaveLength(3);
    expect(fault.message).toContain('execute({ middleware })[0]');
    expect(fault.message).toContain('execute({ middleware })[2]');
    expect(fault.message).toContain('setupArvoEventHandler({ middleware })[0]');
  });

  it('names every repeated id, as a conflict', async () => {
    const fault = await faultOf(
      [{ id: 'tenant' }, { id: 'audit' }],
      [{ id: 'tenant' }, { id: 'audit' }],
    );
    expect(fault.faultKind).toBe('middleware_conflict');
    expect(fault.violations).toHaveLength(2);
    expect(fault.retry).toBeNull();
  });
});

describe('supplied middleware that is not an array', () => {
  it('is refused before any factory is called', async () => {
    const declaredFactory = vi.fn(() => ({ id: 'made' }));
    const fault = await faultOf({ id: 'tenant' }, [declaredFactory as never]);
    expect(declaredFactory).not.toHaveBeenCalled();
    expect(fault.faultKind).toBe('middleware_instantiation_failed');
    expect(fault.message).toContain('must be an array');
  });
});
