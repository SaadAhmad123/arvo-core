import { describe, expect, it, vi } from 'vitest';
import type { ArvoHandlerFault } from '../../../src/ArvoEventHandler/fault/index.js';
import type { IArvoEventHandlerMiddleware } from '../../../src/ArvoEventHandler/types/middleware.js';
import { orderVersion } from '../fixtures.js';
import {
  answering,
  type OrderExecutor,
  openOne,
  orderHandler,
  sleep,
} from './fixture.js';

/**
 * Before parts that misbehave, every way one can.
 *
 * The rule under test: a before part is in the executor's seat, so its
 * failure is the executor's failure, and nothing after it runs.
 */

const run = async (
  before: IArvoEventHandlerMiddleware['before'],
  param: { runTimeout?: number; execute?: OrderExecutor } = {},
) => {
  const execute = vi.fn(param.execute ?? answering);
  const after = vi.fn();
  const ran = await openOne(
    orderHandler({
      execute,
      ...(param.runTimeout === undefined
        ? {}
        : { runTimeout: param.runTimeout }),
      middleware: [{ id: 'misbehaving', before, after }],
    }),
  );
  return { ran, execute, after };
};

describe('a before part that throws something that is not a fault', () => {
  it.each([
    ['an error', new Error('boom')],
    ['a string', 'boom'],
    ['a number', 7],
    ['null', null],
    ['undefined', undefined],
    ['a plain object', { reason: 'boom' }],
  ])(
    'becomes the handler error event, having thrown %s',
    async (_label, value) => {
      const { ran, execute, after } = await run(() => {
        throw value;
      });
      const produced =
        ran.ok && ran.value.kind === 'produced' ? ran.value : null;
      expect(produced?.events[0]?.type).toBe(orderVersion.error.type);
      expect(produced?.state.lifecycle).toBe('error');
      expect(execute).not.toHaveBeenCalled();
      expect(after).not.toHaveBeenCalled();
    },
  );

  it('does the same where it rejects rather than throws', async () => {
    const { ran, execute } = await run(() =>
      Promise.reject(new Error('later')),
    );
    expect(
      ran.ok && ran.value.kind === 'produced' && ran.value.state.lifecycle,
    ).toBe('error');
    expect(execute).not.toHaveBeenCalled();
  });
});

describe('a before part that raises a fault', () => {
  it('stays a fault, retryable where the layer said so', async () => {
    const { ran } = await run(async (ctx) => {
      throw await ctx.fault({
        faultKind: 'executor_raised',
        message: 'again',
        retryable: true,
      });
    });
    expect(!ran.ok && ran.error.faultKind).toBe('executor_raised');
    expect(!ran.ok && ran.error.retry).not.toBeNull();
  });

  it('stays a fault, not retryable where the layer said not', async () => {
    const { ran } = await run(async (ctx) => {
      throw await ctx.fault({
        faultKind: 'executor_raised',
        message: 'never',
        retryable: false,
      });
    });
    expect(!ran.ok && ran.error.retry).toBeNull();
  });

  it('is refused as not its own where it belongs to another execution', async () => {
    const foreign = await (async () => {
      const captured: ArvoHandlerFault[] = [];
      await run(async (ctx) => {
        captured.push(
          await ctx.fault({
            faultKind: 'executor_raised',
            message: 'elsewhere',
          }),
        );
      });
      return captured[0] as ArvoHandlerFault;
    })();
    const { ran } = await run(() => {
      throw foreign;
    });
    expect(!ran.ok && ran.error.faultKind).toBe('executor_raised');
    expect(!ran.ok && ran.error.retry).toBeNull();
    expect(!ran.ok && ran.error.message).toContain('another execution');
  });
});

describe('a before part that writes through the context', () => {
  it('is refused, as the executor would be, where the state is one the schema rejects', async () => {
    const { ran, execute } = await run(async (ctx) => {
      await (
        ctx as never as { setState: (p: unknown) => Promise<void> }
      ).setState({
        data: { stage: 42 },
      });
    });
    expect(!ran.ok && ran.error.faultKind).toBe('state_schema_rejected');
    expect(execute).not.toHaveBeenCalled();
  });

  it('cancels, and the executor answering rests the record at cancelled', async () => {
    const { ran } = await run((ctx) => {
      (ctx as never as { cancel: (reason: string) => void }).cancel(
        'tenant suspended',
      );
    });
    expect(
      ran.ok && ran.value.kind === 'produced' && ran.value.state.lifecycle,
    ).toBe('cancelled');
  });

  it('cancels, and the executor not answering is the cancelled fault', async () => {
    const { ran } = await run(
      (ctx) => {
        (ctx as never as { cancel: (reason: string) => void }).cancel(
          'tenant suspended',
        );
      },
      { execute: async () => undefined },
    );
    expect(!ran.ok && ran.error.faultKind).toBe('execution_cancelled');
  });

  it('may store a value whose own getter writes middleware data, without looping', async () => {
    let seen: unknown;
    const { ran } = await run(
      async (ctx) => {
        await ctx.setMiddleware('lazy', {
          get value() {
            void ctx.setMiddleware('touched', true);
            return 'read';
          },
        });
      },
      {
        execute: async (ctx) => {
          seen = (ctx.middleware.lazy as { value: string }).value;
          await Promise.resolve();
          expect(ctx.middleware.touched).toBe(true);
          return answering(ctx);
        },
      },
    );
    expect(seen).toBe('read');
    expect(ran.ok).toBe(true);
  });
});

describe('a before part that tries what it may not', () => {
  it('builds and returns an event, which goes nowhere', async () => {
    const { ran } = await run(async (ctx) => {
      return (await ctx.build({
        type: 'com_payment_charge',
        data: { amount: 99 },
      })) as never;
    });
    const produced = ran.ok && ran.value.kind === 'produced' ? ran.value : null;
    expect(produced?.events.map((event) => event.type)).toEqual([
      'com_order_created',
    ]);
  });

  it('assigns to a frozen member, which fails as the work failing', async () => {
    const { ran } = await run((ctx) => {
      (ctx as unknown as Record<string, unknown>).attempt = 9;
    });
    expect(
      ran.ok && ran.value.kind === 'produced' && ran.value.state.lifecycle,
    ).toBe('error');
  });
});

describe('a before part that never finishes', () => {
  it('runs the clock out as a retryable run timeout, the executor never entered', async () => {
    const { ran, execute } = await run(
      () => new Promise<void>(() => undefined),
      {
        runTimeout: 20,
      },
    );
    expect(!ran.ok && ran.error.faultKind).toBe('run_timeout');
    expect(!ran.ok && ran.error.retry).not.toBeNull();
    expect(execute).not.toHaveBeenCalled();
  });

  it('enters nothing after it, even where it finishes once the clock has fired', async () => {
    const { execute, after } = await run(() => sleep(50), { runTimeout: 15 });
    await sleep(70);
    expect(execute).not.toHaveBeenCalled();
    expect(after).not.toHaveBeenCalled();
  });
});
