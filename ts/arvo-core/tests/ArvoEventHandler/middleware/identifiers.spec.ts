import { describe, expect, it, vi } from 'vitest';
import { ArvoEventHandlerValidationError } from '../../../src/ArvoEventHandler/errors.js';
import type { IArvoEventHandlerMiddleware } from '../../../src/ArvoEventHandler/types/middleware.js';
import { anOrder, openOne, orderHandler } from './fixture.js';

/** Identifiers of every awkward shape, at both sites. */

const layer = (id: string): IArvoEventHandlerMiddleware => ({
  id,
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
  ])('is accepted where %s', async (_label, id) => {
    const ran = await openOne(orderHandler({ middleware: [layer(id)] }));
    expect(ran.ok).toBe(true);
  });

  it('is still unique where empty: two empty identifiers repeat', () => {
    expect(() => orderHandler({ middleware: [layer(''), layer('')] })).toThrow(
      ArvoEventHandlerValidationError,
    );
  });

  it('treats two identifiers differing only in case as two, at execution too', async () => {
    const ran = await openOne(orderHandler({ middleware: [layer('Same')] }), {
      middleware: [layer('same')],
    });
    expect(ran.ok).toBe(true);
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
    const ran = await openOne(orderHandler(), {
      middleware: [
        { id: Symbol('x') } as unknown as IArvoEventHandlerMiddleware,
      ],
    });
    expect(!ran.ok && ran.error.faultKind).toBe(
      'middleware_instantiation_failed',
    );
  });
});

describe('the same instance listed more than once', () => {
  it('repeats its identifier where supplied twice', async () => {
    const once = layer('once');
    const ran = await openOne(orderHandler(), { middleware: [once, once] });
    expect(!ran.ok && ran.error.faultKind).toBe('middleware_conflict');
  });

  it('repeats its identifier where supplied and declared', async () => {
    const once = layer('once');
    const ran = await openOne(orderHandler({ middleware: [once] }), {
      middleware: [once],
    });
    expect(!ran.ok && ran.error.faultKind).toBe('middleware_conflict');
  });
});

describe('a way to make one, and identity', () => {
  it('may return a different identifier on each call, each execution having its own', async () => {
    let calls = 0;
    const handler = orderHandler({
      middleware: [() => layer(`made_${++calls}`)],
    });
    expect((await openOne(handler, { event: anOrder('a') })).ok).toBe(true);
    expect((await openOne(handler, { event: anOrder('b') })).ok).toBe(true);
    expect(calls).toBe(2);
  });

  it('may return the same instance every time, which then serves every execution', async () => {
    const shared = {
      id: 'shared',
      before: vi.fn(),
    } satisfies IArvoEventHandlerMiddleware;
    const handler = orderHandler({ middleware: [() => shared] });
    await openOne(handler, { event: anOrder('a') });
    await openOne(handler, { event: anOrder('b') });
    expect(shared.before).toHaveBeenCalledTimes(2);
  });

  it('is called again on a further attempt of the same execution', async () => {
    const make = vi.fn(() => layer('made'));
    const handler = orderHandler({ middleware: [make] });
    const order = anOrder();
    await openOne(handler, { event: order, attempt: 0 });
    await openOne(handler, { event: order, attempt: 1 });
    expect(make).toHaveBeenCalledTimes(2);
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
    const ran = await openOne(orderHandler(), { middleware: null as never });
    expect(ran.ok).toBe(true);
  });

  it('is refused at execution where supplied as a single layer', async () => {
    const ran = await openOne(orderHandler(), {
      middleware: { id: 'alone' } as never,
    });
    expect(!ran.ok && ran.error.faultKind).toBe(
      'middleware_instantiation_failed',
    );
  });
});
