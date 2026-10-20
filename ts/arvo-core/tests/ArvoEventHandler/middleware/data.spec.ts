import { describe, expect, it } from 'vitest';
import type { ArvoExecutionContext } from '../../../src/ArvoEventHandler/context/index.js';
import { answering, openOne, orderHandler } from './fixture.js';

/**
 * Middleware data, attacked through its keys and its values.
 *
 * Each test writes in a before part and reads in the executor, which is
 * the path the data exists for.
 */

const through = async (
  write: (ctx: ArvoExecutionContext) => Promise<void>,
  read: (ctx: ArvoExecutionContext) => void,
) => {
  const ran = await openOne(
    orderHandler({
      middleware: [{ id: 'writer', before: write }],
      execute: async (ctx) => {
        read(ctx as unknown as ArvoExecutionContext);
        return answering(ctx);
      },
    }),
  );
  return ran;
};

describe('keys that are names every object has', () => {
  it.each([
    '__proto__',
    'constructor',
    'prototype',
    'toString',
    'hasOwnProperty',
    'valueOf',
  ])('stores %s as itself and pollutes nothing', async (key) => {
    let read: unknown;
    const ran = await through(
      (ctx) => ctx.setMiddleware(key, 'stored'),
      (ctx) => {
        read = Object.getOwnPropertyDescriptor(ctx.middleware, key)?.value;
      },
    );
    expect(ran.ok).toBe(true);
    expect(read).toBe('stored');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
  });

  it('cannot reach the prototype through a value shaped like one', async () => {
    await through(
      (ctx) => ctx.setMiddleware('__proto__', { polluted: true }),
      () => undefined,
    );
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('values of every kind', () => {
  it.each([
    ['a function', () => 'called'],
    [
      'a class instance',
      new (class Tenant {
        readonly id = 't-1';
      })(),
    ],
    ['a frozen object', Object.freeze({ id: 'frozen' })],
    ['a symbol', Symbol('marker')],
    ['a big integer', 10n ** 30n],
    ['a date', new Date(0)],
    ['a map', new Map([['a', 1]])],
  ])(
    'holds %s by reference and reads it back identical',
    async (_label, value) => {
      let read: unknown;
      await through(
        (ctx) => ctx.setMiddleware('value', value),
        (ctx) => {
          read = ctx.middleware.value;
        },
      );
      expect(read).toBe(value);
    },
  );

  it('holds a cyclic value without trying to serialize it', async () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    let read: unknown;
    const ran = await through(
      (ctx) => ctx.setMiddleware('cyclic', cyclic),
      (ctx) => {
        read = ctx.middleware.cyclic;
      },
    );
    expect(ran.ok).toBe(true);
    expect(read).toBe(cyclic);
  });

  it('holds the context itself without it reaching the record', async () => {
    const ran = await through(
      (ctx) => ctx.setMiddleware('ctx', ctx),
      () => undefined,
    );
    expect(ran.ok).toBe(true);
    const record =
      ran.ok && ran.value.kind === 'produced' ? ran.value.state : null;
    expect(JSON.stringify(record)).not.toContain('"ctx"');
  });

  it('freezes what reads it, not what it holds: a layer may change its own stored object', async () => {
    const owned = { count: 0 };
    let read: unknown;
    await through(
      async (ctx) => {
        await ctx.setMiddleware('owned', owned);
        owned.count += 1;
      },
      (ctx) => {
        read = (ctx.middleware.owned as { count: number }).count;
      },
    );
    expect(read).toBe(1);
  });
});

describe('a key written twice, through the handler', () => {
  it('is a non-retryable middleware conflict, by whichever layer wrote second', async () => {
    const ran = await openOne(
      orderHandler({
        middleware: [
          { id: 'inner', before: (ctx) => ctx.setMiddleware('tenant', 'b') },
        ],
      }),
      {
        middleware: [
          { id: 'outer', before: (ctx) => ctx.setMiddleware('tenant', 'a') },
        ],
      },
    );
    expect(!ran.ok && ran.error.faultKind).toBe('middleware_conflict');
    expect(!ran.ok && ran.error.message).toContain('tenant');
    expect(!ran.ok && ran.error.retry).toBeNull();
  });

  it('is a conflict where the first write was nothing at all', async () => {
    const ran = await openOne(
      orderHandler({
        middleware: [
          {
            id: 'twice',
            before: async (ctx) => {
              await ctx.setMiddleware('flag', undefined);
              await ctx.setMiddleware('flag', true);
            },
          },
        ],
      }),
    );
    expect(!ran.ok && ran.error.faultKind).toBe('middleware_conflict');
  });

  it('is a conflict where the executor writes a key a layer already wrote', async () => {
    const ran = await openOne(
      orderHandler({
        middleware: [
          { id: 'layer', before: (ctx) => ctx.setMiddleware('k', 1) },
        ],
        execute: async (ctx) => {
          await ctx.setMiddleware('k', 2);
          return answering(ctx);
        },
      }),
    );
    expect(!ran.ok && ran.error.faultKind).toBe('middleware_conflict');
  });
});
