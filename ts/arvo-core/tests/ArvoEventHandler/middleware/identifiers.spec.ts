import { describe, expect, it, vi } from 'vitest';
import { ArvoEventHandlerValidationError } from '../../../src/ArvoEventHandler/errors.js';
import type { IArvoEventHandlerMiddleware } from '../../../src/ArvoEventHandler/types/middleware.js';
import { executeOrder, orderHandler, orderRequest } from './fixture.js';

/** Identifiers of every awkward shape, at both sites. */

const layerNamed = (awkwardId: string): IArvoEventHandlerMiddleware => ({
  id: awkwardId,
  before: () => undefined,
});

describe('an identifier of an awkward shape', () => {
  it.each([
    ['empty', ''],
    ['whitespace', '   '],
    ['very long', 'x'.repeat(10_000)],
    ['unicode', 'ミドルウェア-✓'],
    ['with a dot', 'a.b'],
    ['a name every object has', '__proto__'],
  ])('is accepted where %s', async (_label, awkwardId) => {
    const executionResult = await executeOrder(
      orderHandler({ middleware: [layerNamed(awkwardId)] }),
    );
    expect(executionResult.ok).toBe(true);
  });

  it('is still unique where empty: two empty identifiers repeat', () => {
    expect(() =>
      orderHandler({ middleware: [layerNamed(''), layerNamed('')] }),
    ).toThrow(ArvoEventHandlerValidationError);
  });

  it('treats two identifiers differing only in case as two, at execution too', async () => {
    const executionResult = await executeOrder(
      orderHandler({ middleware: [layerNamed('Same')] }),
      {
        middleware: [layerNamed('same')],
      },
    );
    expect(executionResult.ok).toBe(true);
  });
});

describe('an identifier that is not a string, from a caller no compiler saw', () => {
  it('is refused at build where declared', () => {
    expect(() =>
      orderHandler({
        middleware: [{ id: 12 } as unknown as IArvoEventHandlerMiddleware],
      }),
    ).toThrow(ArvoEventHandlerValidationError);
  });

  it('is refused at execution where supplied', async () => {
    const executionResult = await executeOrder(orderHandler(), {
      middleware: [
        { id: Symbol('x') } as unknown as IArvoEventHandlerMiddleware,
      ],
    });
    expect(!executionResult.ok && executionResult.error.faultKind).toBe(
      'middleware_instantiation_failed',
    );
  });
});

describe('the same instance listed more than once', () => {
  it('repeats its identifier where supplied twice', async () => {
    const sameLayer = layerNamed('once');
    const executionResult = await executeOrder(orderHandler(), {
      middleware: [sameLayer, sameLayer],
    });
    expect(!executionResult.ok && executionResult.error.faultKind).toBe(
      'middleware_conflict',
    );
  });

  it('repeats its identifier where supplied and declared', async () => {
    const sameLayer = layerNamed('once');
    const executionResult = await executeOrder(
      orderHandler({ middleware: [sameLayer] }),
      {
        middleware: [sameLayer],
      },
    );
    expect(!executionResult.ok && executionResult.error.faultKind).toBe(
      'middleware_conflict',
    );
  });
});

describe('a way to make one, and identity', () => {
  it('may return a different identifier on each call, each execution having its own', async () => {
    let factoryCalls = 0;
    const handler = orderHandler({
      middleware: [() => layerNamed(`made_${++factoryCalls}`)],
    });
    expect((await executeOrder(handler, { event: orderRequest('a') })).ok).toBe(
      true,
    );
    expect((await executeOrder(handler, { event: orderRequest('b') })).ok).toBe(
      true,
    );
    expect(factoryCalls).toBe(2);
  });

  it('may return the same instance every time, which then serves every execution', async () => {
    const sharedLayer = {
      id: 'shared',
      before: vi.fn(),
    } satisfies IArvoEventHandlerMiddleware;
    const handler = orderHandler({ middleware: [() => sharedLayer] });
    await executeOrder(handler, { event: orderRequest('a') });
    await executeOrder(handler, { event: orderRequest('b') });
    expect(sharedLayer.before).toHaveBeenCalledTimes(2);
  });

  it('is called again on a further attempt of the same execution', async () => {
    const makeLayer = vi.fn(() => layerNamed('made'));
    const handler = orderHandler({ middleware: [makeLayer] });
    const orderEvent = orderRequest();
    await executeOrder(handler, { event: orderEvent, attempt: 0 });
    await executeOrder(handler, { event: orderEvent, attempt: 1 });
    expect(makeLayer).toHaveBeenCalledTimes(2);
  });
});

describe('a list that is not a list, from a caller no compiler saw', () => {
  it('is refused at build where declared as a single layer', () => {
    expect(() =>
      orderHandler({ middleware: { id: 'alone' } as never }),
    ).toThrow(ArvoEventHandlerValidationError);
  });

  it('reads null as none where declared', () => {
    expect(orderHandler({ middleware: null as never }).middleware).toBeNull();
  });

  it('reads null as none where supplied', async () => {
    const executionResult = await executeOrder(orderHandler(), {
      middleware: null as never,
    });
    expect(executionResult.ok).toBe(true);
  });

  it('is refused at execution where supplied as a single layer', async () => {
    const executionResult = await executeOrder(orderHandler(), {
      middleware: { id: 'alone' } as never,
    });
    expect(!executionResult.ok && executionResult.error.faultKind).toBe(
      'middleware_instantiation_failed',
    );
  });
});
