import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import type { ArvoExecutionContext } from '../../../src/ArvoEventHandler/context/index.js';
import type { ArvoExecutorEmission } from '../../../src/ArvoEventHandler/types/execute.js';
import type {
  ArvoEventHandlerMiddlewareEntry,
  IArvoEventHandlerMiddleware,
} from '../../../src/ArvoEventHandler/types/middleware.js';
import type { orderVersion, services } from '../fixtures.js';

const orderState = z.object({ stage: z.string() });

/**
 * What a layer is allowed to be.
 *
 * Checked by the compiler through `pnpm typecheck`, and run so that a
 * declaration that only looked right in an editor still has to compile
 * where the suite does.
 */

class BeforeOnly implements IArvoEventHandlerMiddleware<'before_only'> {
  readonly id = 'before_only' as const;
  before(_ctx: ArvoExecutionContext): void {}
}

class AfterOnly implements IArvoEventHandlerMiddleware<'after_only'> {
  readonly id = 'after_only' as const;
  async after(
    _ctx: ArvoExecutionContext,
    _emission: Readonly<ArvoExecutorEmission>,
  ): Promise<void> {}
}

class Both implements IArvoEventHandlerMiddleware<'both'> {
  readonly id = 'both' as const;
  async before(_ctx: ArvoExecutionContext): Promise<void> {}
  after(_ctx: ArvoExecutionContext): void {}
}

class Neither implements IArvoEventHandlerMiddleware<'neither'> {
  readonly id = 'neither' as const;
}

describe('a layer', () => {
  it('may have a before part, an after part, both, or neither', () => {
    const layers: IArvoEventHandlerMiddleware[] = [
      new BeforeOnly(),
      new AfterOnly(),
      new Both(),
      new Neither(),
    ];
    expect(layers.map((literalLayer) => literalLayer.id)).toEqual([
      'before_only',
      'after_only',
      'both',
      'neither',
    ]);
  });

  it('carries its identifier as the literal it was declared with', () => {
    expectTypeOf(new Both().id).toEqualTypeOf<'both'>();
  });

  it('may be written as a plain object as well as a class', () => {
    const literal: IArvoEventHandlerMiddleware<'literal'> = {
      id: 'literal',
      before: () => undefined,
    };
    expect(literal.id).toBe('literal');
  });

  it('may be typed for one handler, reaching what that handler declared', () => {
    class ForOrders
      implements
        IArvoEventHandlerMiddleware<
          'for_orders',
          typeof orderVersion,
          typeof services,
          typeof orderState,
          { directory: { lookup: (subject: string) => string } }
        >
    {
      readonly id = 'for_orders' as const;
      before(
        ctx: ArvoExecutionContext<
          typeof orderVersion,
          typeof services,
          typeof orderState,
          { directory: { lookup: (subject: string) => string } }
        >,
      ): void {
        expectTypeOf(ctx.dependencies?.directory?.lookup).toEqualTypeOf<
          ((subject: string) => string) | undefined
        >();
      }
    }
    expect(new ForOrders().id).toBe('for_orders');
  });

  it('returns nothing from either part', () => {
    const invalidLayer = {
      id: 'wrong',
      // @ts-expect-error a before part returns nothing
      before: () => 1,
    } satisfies IArvoEventHandlerMiddleware<'wrong'>;
    expect(invalidLayer.id).toBe('wrong');
  });
});

describe('an entry in a list of layers', () => {
  it('is a layer, or a way to make one', () => {
    const entries: ArvoEventHandlerMiddlewareEntry[] = [
      new Both(),
      () => new Both(),
      async () => new AfterOnly(),
    ];
    expect(entries).toHaveLength(3);
  });

  it('is not a way to make one that takes anything', () => {
    // @ts-expect-error a factory takes nothing
    const entry: ArvoEventHandlerMiddlewareEntry = (_given: string) =>
      new Both();
    expect(entry).toBeTypeOf('function');
  });
});
