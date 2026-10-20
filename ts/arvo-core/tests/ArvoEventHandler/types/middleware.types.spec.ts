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
    const layer = {
      id: 'literal' as const,
    } satisfies IArvoEventHandlerMiddleware<'literal'>;
    expectTypeOf(layer.id).toEqualTypeOf<'literal'>();
  });

  it('refuses a part that returns a value', () => {
    const wrong: IArvoEventHandlerMiddleware = {
      id: 'wrong',
      // @ts-expect-error an after part returns nothing
      after: () => 'value',
    };
    expect(wrong.id).toBe('wrong');
  });

  it('reads middleware data as values to narrow, never as anything', () => {
    expectTypeOf<ArvoExecutionContext['middleware']>().toEqualTypeOf<
      Readonly<Record<string, unknown>>
    >();
  });

  it('refuses a write through what reads middleware data', () => {
    const write = (ctx: ArvoExecutionContext) => {
      // @ts-expect-error the read member is read-only
      ctx.middleware.anything = 1;
    };
    expect(write).toBeTypeOf('function');
  });
});

describe('where layers are listed', () => {
  it('is optional on the declaration, and never null', () => {
    const omitted: Pick<
      ArvoEventHandlerSetupParam<
        typeof orderContract,
        Record<string, never>,
        Record<string, never>,
        Record<string, never>
      >,
      'middleware'
    > = {};
    expect(omitted).toEqual({});
    // a caller no compiler saw is still handled: null reads as none
    const built = setupArvoEventHandler({
      contracts: { self: orderContract },
      // @ts-expect-error null is not a way to say there are none — omit it
      middleware: null,
    })
      .handler('1.0.0', async () => undefined)
      .build();
    expect(built.middleware).toBeNull();
  });

  it('is optional on an execution, and never null', () => {
    const omitted: Pick<
      ArvoEventHandlerExecuteParam<
        Record<string, never>,
        Record<string, never>
      >,
      'middleware'
    > = {};
    expect(omitted).toEqual({});
    const nulled: Pick<
      ArvoEventHandlerExecuteParam<
        Record<string, never>,
        Record<string, never>
      >,
      'middleware'
    > = {
      // @ts-expect-error null is not a way to say there are none — omit it
      middleware: null,
    };
    expect(nulled).toBeDefined();
  });

  it('takes a layer or a way to make one, and nothing else', () => {
    const entries: ArvoEventHandlerMiddlewareEntry[] = [
      { id: 'layer' },
      () => ({ id: 'made' }),
      async () => ({ id: 'made_later' }),
    ];
    expect(entries).toHaveLength(3);
    // @ts-expect-error a string is not a layer
    const wrong: ArvoEventHandlerMiddlewareEntry = 'layer';
    expect(wrong).toBe('layer');
  });

  it('refuses a layer typed for different dependencies than the handler declares', () => {
    const forPayments: IArvoEventHandlerMiddleware<
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
      middleware: [forPayments],
    });
    expect(forPayments.id).toBe('for_payments');
  });
});

describe('layers listed on a handler', () => {
  it('leave the dependencies the handler declared as declared', () => {
    const generic: IArvoEventHandlerMiddleware = { id: 'generic' };
    setupArvoEventHandler({
      contracts: { self: orderContract },
      types: {} as {
        dependencies: { db: { query: (sql: string) => string[] } };
      },
      middleware: [generic, () => generic],
    }).handler('1.0.0', async (ctx) => {
      expectTypeOf(ctx.dependencies?.db?.query).toEqualTypeOf<
        ((sql: string) => string[]) | undefined
      >();
    });
    expect(generic.id).toBe('generic');
  });

  it('leave the hooks the handler declared as declared', () => {
    const generic: IArvoEventHandlerMiddleware = { id: 'generic' };
    setupArvoEventHandler({
      contracts: { self: orderContract },
      types: {} as { mechanismHooks: { scheduler: { now: () => number } } },
      middleware: [generic],
    }).handler('1.0.0', async (ctx) => {
      expectTypeOf(ctx.hooks?.scheduler?.now).toEqualTypeOf<
        (() => number) | undefined
      >();
    });
    expect(generic.id).toBe('generic');
  });
});
