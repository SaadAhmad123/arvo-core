import { describe, expect, it, vi } from 'vitest';
import { ArvoEventHandlerValidationError } from '../../../src/ArvoEventHandler/errors.js';
import type {
  ArvoEventHandlerMiddlewareEntry,
  IArvoEventHandlerMiddleware,
} from '../../../src/ArvoEventHandler/types/middleware.js';
import { setupArvoEventHandler } from '../../../src/factories/setupArvoEventHandler.js';
import { orderContract } from '../fixtures.js';

/** A layer that does nothing, named as asked. */
const layer = (id: string): IArvoEventHandlerMiddleware => ({ id });

const declare = (
  middleware?: readonly ArvoEventHandlerMiddlewareEntry[],
  options?: { maxDepth: number },
) =>
  setupArvoEventHandler({
    contracts: { self: orderContract },
    ...(middleware === undefined ? {} : { middleware }),
    ...(options === undefined ? {} : { options }),
  }).handler('1.0.0', async () => undefined);

const refusalOf = (built: () => unknown): ArvoEventHandlerValidationError => {
  try {
    built();
  } catch (raised) {
    return raised as ArvoEventHandlerValidationError;
  }
  throw new Error('the declaration was accepted');
};

describe('a handler declaring no layers', () => {
  it('holds none where none were named', () => {
    expect(declare().build().middleware).toBeNull();
  });

  it('holds none where an empty list was named, the two meaning the same', () => {
    expect(declare([]).build().middleware).toBeNull();
  });
});

describe('a handler declaring layers', () => {
  it('holds every one, in the order declared, as given', () => {
    const first = layer('first');
    const second = layer('second');
    const held = declare([first, second]).build().middleware;
    expect(held).toEqual([first, second]);
    expect(held?.[0]).toBe(first);
    expect(held?.[1]).toBe(second);
  });

  it('holds them as a list nothing can change', () => {
    const held = declare([layer('first')]).build().middleware;
    expect(Object.isFrozen(held)).toBe(true);
  });

  it('is not changed by the list it was given changing later', () => {
    const given = [layer('first')];
    const handler = declare(given).build();
    given.push(layer('second'));
    expect(handler.middleware).toHaveLength(1);
  });

  it('carries them through every version added to the declaration', () => {
    const only = layer('only');
    const setup = setupArvoEventHandler({
      contracts: { self: orderContract },
      middleware: [only],
    });
    expect(
      setup.handler('1.0.0', async () => undefined).build().middleware,
    ).toEqual([only]);
  });

  it('holds a way to make a layer as given, and does not call it', () => {
    const make = vi.fn(() => layer('made'));
    const held = declare([make]).build().middleware;
    expect(held?.[0]).toBe(make);
    expect(make).not.toHaveBeenCalled();
  });
});

describe('a declaration naming two layers with one identifier', () => {
  it('is refused', () => {
    expect(() => declare([layer('same'), layer('same')]).build()).toThrow(
      ArvoEventHandlerValidationError,
    );
  });

  it('names the identifier, at the second one', () => {
    const refused = refusalOf(() =>
      declare([layer('same'), layer('other'), layer('same')]).build(),
    );
    const issue = refused.issues.find(
      (each) => each.path === 'middleware[2].id',
    );
    expect(issue).toBeDefined();
    expect(issue?.toString()).toContain('same');
  });

  it('reports each repeat, not only the first', () => {
    const refused = refusalOf(() =>
      declare([layer('a'), layer('a'), layer('b'), layer('b')]).build(),
    );
    expect(refused.issues.map((issue) => issue.path)).toEqual(
      expect.arrayContaining(['middleware[1].id', 'middleware[3].id']),
    );
  });

  it('is reported alongside every other rule the declaration broke', () => {
    const refused = refusalOf(() =>
      declare([layer('same'), layer('same')], { maxDepth: -1 }).build(),
    );
    const paths = refused.issues.map((issue) => issue.path);
    expect(paths).toContain('middleware[1].id');
    expect(paths.some((path) => path.startsWith('options'))).toBe(true);
  });

  it('is reported by tryBuild rather than thrown', () => {
    const built = declare([layer('same'), layer('same')]).tryBuild();
    expect(built.ok).toBe(false);
  });

  it('treats two identifiers differing only in case as two', () => {
    expect(
      declare([layer('Same'), layer('same')]).build().middleware,
    ).toHaveLength(2);
  });

  it('treats the same layer named twice as a repeat of its identifier', () => {
    const once = layer('once');
    expect(() => declare([once, once]).build()).toThrow(
      ArvoEventHandlerValidationError,
    );
  });

  it('does not check a way to make one, which is not called until an execution', () => {
    expect(
      declare([layer('same'), () => layer('same')]).build().middleware,
    ).toHaveLength(2);
  });
});

describe('a declaration naming something that is not a layer', () => {
  it.each([
    ['a layer with no identifier', {}],
    ['an identifier that is not a string', { id: 42 }],
    ['nothing at all', null],
    ['a number', 7],
  ])('refuses %s', (_label, entry) => {
    const refused = refusalOf(() =>
      declare([entry as unknown as ArvoEventHandlerMiddlewareEntry]).build(),
    );
    expect(refused.issues.map((issue) => issue.path)).toContain(
      'middleware[0]',
    );
  });

  it('refuses a before part that is not something to call', () => {
    const refused = refusalOf(() =>
      declare([
        {
          id: 'wrong',
          before: 'soon',
        } as unknown as IArvoEventHandlerMiddleware,
      ]).build(),
    );
    expect(refused.issues.map((issue) => issue.path)).toContain(
      'middleware[0].before',
    );
  });

  it('refuses an after part that is not something to call', () => {
    const refused = refusalOf(() =>
      declare([
        { id: 'wrong', after: 1 } as unknown as IArvoEventHandlerMiddleware,
      ]).build(),
    );
    expect(refused.issues.map((issue) => issue.path)).toContain(
      'middleware[0].after',
    );
  });
});
