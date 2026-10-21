import { describe, expect, it } from 'vitest';
import type { ArvoExecutionContext } from '../../../src/ArvoEventHandler/context/index.js';
import { answeringExecutor, executeOrder, orderHandler } from './fixture.js';

/**
 * Middleware data, attacked through its keys and its values.
 *
 * Each test writes in a before part and reads in the executor, which is
 * the path the data exists for.
 */

const writeThenRead = async (
  write: (ctx: ArvoExecutionContext) => Promise<void>,
  readBack: (ctx: ArvoExecutionContext) => void,
) => {
  const executionResult = await executeOrder(
    orderHandler({
      middleware: [{ id: 'writer', before: write }],
      execute: async (ctx) => {
        readBack(ctx as unknown as ArvoExecutionContext);
        return answeringExecutor(ctx);
      },
    }),
  );
  return executionResult;
};

describe('keys that are names every object has', () => {
  it.each([
    '__proto__',
    'constructor',
    'prototype',
    'toString',
    'hasOwnProperty',
    'valueOf',
  ])('stores %s as itself and pollutes nothing', async (reservedKey) => {
    let readBack: unknown;
    const executionResult = await writeThenRead(
      (ctx) => ctx.setMiddleware(reservedKey, 'stored'),
      (ctx) => {
        readBack = Object.getOwnPropertyDescriptor(
          ctx.middleware,
          reservedKey,
        )?.value;
      },
    );
    expect(executionResult.ok).toBe(true);
    expect(readBack).toBe('stored');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
  });

  it('cannot reach the prototype through a value shaped like one', async () => {
    await writeThenRead(
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
    async (_label, storedValue) => {
      let readBack: unknown;
      await writeThenRead(
        (ctx) => ctx.setMiddleware('value', storedValue),
        (ctx) => {
          readBack = ctx.middleware.value;
        },
      );
      expect(readBack).toBe(storedValue);
    },
  );

  it('holds a cyclic value without trying to serialize it', async () => {
    const cyclicValue: Record<string, unknown> = {};
    cyclicValue.self = cyclicValue;
    let readBack: unknown;
    const executionResult = await writeThenRead(
      (ctx) => ctx.setMiddleware('cyclic', cyclicValue),
      (ctx) => {
        readBack = ctx.middleware.cyclic;
      },
    );
    expect(executionResult.ok).toBe(true);
    expect(readBack).toBe(cyclicValue);
  });

  it('holds the context itself without it reaching the record', async () => {
    const executionResult = await writeThenRead(
      (ctx) => ctx.setMiddleware('ctx', ctx),
      () => undefined,
    );
    expect(executionResult.ok).toBe(true);
    const producedRecord =
      executionResult.ok && executionResult.value.kind === 'produced'
        ? executionResult.value.state
        : null;
    expect(JSON.stringify(producedRecord)).not.toContain('"ctx"');
  });

  it('freezes what reads it, not what it holds: a layer may change its own stored object', async () => {
    const ownedObject = { count: 0 };
    let readBack: unknown;
    await writeThenRead(
      async (ctx) => {
        await ctx.setMiddleware('owned', ownedObject);
        ownedObject.count += 1;
      },
      (ctx) => {
        readBack = (ctx.middleware.owned as { count: number }).count;
      },
    );
    expect(readBack).toBe(1);
  });
});

describe('a key written twice, through the handler', () => {
  it('is a non-retryable middleware conflict, by whichever layer wrote second', async () => {
    const executionResult = await executeOrder(
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
    expect(!executionResult.ok && executionResult.error.faultKind).toBe(
      'middleware_conflict',
    );
    expect(!executionResult.ok && executionResult.error.message).toContain(
      'tenant',
    );
    expect(!executionResult.ok && executionResult.error.retry).toBeNull();
  });

  it('is a conflict where the first write was nothing at all', async () => {
    const executionResult = await executeOrder(
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
    expect(!executionResult.ok && executionResult.error.faultKind).toBe(
      'middleware_conflict',
    );
  });

  it('is a conflict where the executor writes a key a layer already wrote', async () => {
    const executionResult = await executeOrder(
      orderHandler({
        middleware: [
          { id: 'layer', before: (ctx) => ctx.setMiddleware('k', 1) },
        ],
        execute: async (ctx) => {
          await ctx.setMiddleware('k', 2);
          return answeringExecutor(ctx);
        },
      }),
    );
    expect(!executionResult.ok && executionResult.error.faultKind).toBe(
      'middleware_conflict',
    );
  });
});
