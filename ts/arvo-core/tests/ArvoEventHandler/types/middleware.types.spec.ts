import { describe, expect, expectTypeOf, it } from 'vitest';
import type { ArvoExecutionContext } from '../../../src/ArvoEventHandler/context/index.js';
import type { ArvoEventHandlerExecuteParam } from '../../../src/ArvoEventHandler/types/execute.js';
import type {
  ArvoEventHandlerMiddlewareEntry,
  IArvoEventHandlerMiddleware,
} from '../../../src/ArvoEventHandler/types/middleware.js';
import type { ArvoEventHandlerSetupParam } from '../../../src/ArvoEventHandler/types/setup.js';
import { setupArvoEventHandler } from '../../../src/factories/setupArvoEventHandler.js';
import { orderContract } from '../fixtures.js';

/**
 * The type level, run so it compiles where the suite does.
 *
 * Each `@ts-expect-error` is an assertion: if the line stopped being an
 * error, `pnpm typecheck` would fail on the directive itself.
 */

describe('what the compiler holds a layer to', () => {
  it('keeps a declared identifier as its literal', () => {
    const literalLayer = {
      id: 'literal' as const,
    } satisfies IArvoEventHandlerMiddleware<'literal'>;
    expectTypeOf(literalLayer.id).toEqualTypeOf<'literal'>();
  });

  it('refuses a part that returns a value', () => {
    const invalidLayer: IArvoEventHandlerMiddleware = {
      id: 'wrong',
      // @ts-expect-error an after part returns nothing
      after: () => 'value',
    };
    expect(invalidLayer.id).toBe('wrong');
  });

  it('reads middleware data as values to narrow, never as anything', () => {
    expectTypeOf<ArvoExecutionContext['middleware']>().toEqualTypeOf<
      Readonly<Record<string, unknown>>
    >();
  });

  it('refuses a write through what reads middleware data', () => {
    const writeThroughReadMember = (ctx: ArvoExecutionContext) => {
      // @ts-expect-error the read member is read-only
      ctx.middleware.anything = 1;
    };
    expect(writeThroughReadMember).toBeTypeOf('function');
  });
});

describe('where layers are listed', () => {
  it('is optional on the declaration, and never null', () => {
    const paramWithoutMiddleware: Pick<
      ArvoEventHandlerSetupParam<
        typeof orderContract,
        Record<string, never>,
        Record<string, never>,
        Record<string, never>
      >,
      'middleware'
    > = {};
    expect(paramWithoutMiddleware).toEqual({});
    // a caller no compiler saw is still handled: null reads as none
    const builtHandler = setupArvoEventHandler({
      contracts: { self: orderContract },
      // @ts-expect-error null is not a way to say there are none — omit it
      middleware: null,
    })
      .handler('1.0.0', async () => undefined)
      .build();
    expect(builtHandler.middleware).toBeNull();
  });

  it('is optional on an execution, and never null', () => {
    const paramWithoutMiddleware: Pick<
      ArvoEventHandlerExecuteParam<
        Record<string, never>,
        Record<string, never>
      >,
      'middleware'
    > = {};
    expect(paramWithoutMiddleware).toEqual({});
    const paramWithNullMiddleware: Pick<
      ArvoEventHandlerExecuteParam<
        Record<string, never>,
        Record<string, never>
      >,
      'middleware'
    > = {
      // @ts-expect-error null is not a way to say there are none — omit it
      middleware: null,
    };
    expect(paramWithNullMiddleware).toBeDefined();
  });

  it('takes a layer or a way to make one, and nothing else', () => {
    const middlewareEntries: ArvoEventHandlerMiddlewareEntry[] = [
      { id: 'layer' },
      () => ({ id: 'made' }),
      async () => ({ id: 'made_later' }),
    ];
    expect(middlewareEntries).toHaveLength(3);
    // @ts-expect-error a string is not a layer
    const invalidLayer: ArvoEventHandlerMiddlewareEntry = 'layer';
    expect(invalidLayer).toBe('layer');
  });

  it('refuses a layer typed for different dependencies than the handler declares', () => {
    const paymentsLayer: IArvoEventHandlerMiddleware<
      'for_payments',
      never,
      never,
      never,
      { gateway: { charge: () => void } }
    > = { id: 'for_payments' };
    setupArvoEventHandler({
      contracts: { self: orderContract },
      types: {} as { dependencies: { db: { query: () => void } } },
      // @ts-expect-error this layer expects a gateway the handler does not declare
      middleware: [paymentsLayer],
    });
    expect(paymentsLayer.id).toBe('for_payments');
  });
});

describe('layers listed on a handler', () => {
  it('leave the dependencies the handler declared as declared', () => {
    const genericLayer: IArvoEventHandlerMiddleware = { id: 'generic' };
    setupArvoEventHandler({
      contracts: { self: orderContract },
      types: {} as {
        dependencies: { db: { query: (sql: string) => string[] } };
      },
      middleware: [genericLayer, () => genericLayer],
    }).handler('1.0.0', async (ctx) => {
      expectTypeOf(ctx.dependencies?.db?.query).toEqualTypeOf<
        ((sql: string) => string[]) | undefined
      >();
    });
    expect(genericLayer.id).toBe('generic');
  });

  it('leave the hooks the handler declared as declared', () => {
    const genericLayer: IArvoEventHandlerMiddleware = { id: 'generic' };
    setupArvoEventHandler({
      contracts: { self: orderContract },
      types: {} as { mechanismHooks: { scheduler: { now: () => number } } },
      middleware: [genericLayer],
    }).handler('1.0.0', async (ctx) => {
      expectTypeOf(ctx.hooks?.scheduler?.now).toEqualTypeOf<
        (() => number) | undefined
      >();
    });
    expect(genericLayer.id).toBe('generic');
  });
});
