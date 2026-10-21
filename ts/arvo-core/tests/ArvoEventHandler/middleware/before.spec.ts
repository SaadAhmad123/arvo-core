import { describe, expect, it, vi } from 'vitest';
import type { ArvoHandlerFault } from '../../../src/ArvoEventHandler/fault/index.js';
import type { IArvoEventHandlerMiddleware } from '../../../src/ArvoEventHandler/types/middleware.js';
import { orderVersion } from '../fixtures.js';
import {
  answeringExecutor,
  executeOrder,
  type OrderExecutor,
  orderHandler,
  sleep,
} from './fixture.js';

/**
 * Before parts that misbehave, every way one can.
 *
 * The rule under test: a before part is in the executor's seat, so its
 * failure is the executor's failure, and nothing after it runs.
 */

const runWithBeforePart = async (
  beforePart: IArvoEventHandlerMiddleware['before'],
  param: { runTimeout?: number; execute?: OrderExecutor } = {},
) => {
  const executorSpy = vi.fn(param.execute ?? answeringExecutor);
  const afterSpy = vi.fn();
  const executionResult = await executeOrder(
    orderHandler({
      execute: executorSpy,
      ...(param.runTimeout === undefined
        ? {}
        : { runTimeout: param.runTimeout }),
      middleware: [{ id: 'misbehaving', before: beforePart, after: afterSpy }],
    }),
  );
  return { executionResult, executorSpy, afterSpy };
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
    async (_label, thrownValue) => {
      const { executionResult, executorSpy, afterSpy } =
        await runWithBeforePart(() => {
          throw thrownValue;
        });
      const producedValue =
        executionResult.ok && executionResult.value.kind === 'produced'
          ? executionResult.value
          : null;
      expect(producedValue?.events[0]?.type).toBe(orderVersion.error.type);
      expect(producedValue?.state.lifecycle).toBe('error');
      expect(executorSpy).not.toHaveBeenCalled();
      expect(afterSpy).not.toHaveBeenCalled();
    },
  );

  it('does the same where it rejects rather than throws', async () => {
    const { executionResult, executorSpy } = await runWithBeforePart(() =>
      Promise.reject(new Error('later')),
    );
    expect(
      executionResult.ok &&
        executionResult.value.kind === 'produced' &&
        executionResult.value.state.lifecycle,
    ).toBe('error');
    expect(executorSpy).not.toHaveBeenCalled();
  });
});

describe('a before part that raises a fault', () => {
  it('stays a fault, retryable where the layer said so', async () => {
    const { executionResult } = await runWithBeforePart(async (ctx) => {
      throw await ctx.fault({
        faultKind: 'executor_raised',
        message: 'again',
        retryable: true,
      });
    });
    expect(!executionResult.ok && executionResult.error.faultKind).toBe(
      'executor_raised',
    );
    expect(!executionResult.ok && executionResult.error.retry).not.toBeNull();
  });

  it('stays a fault, not retryable where the layer said not', async () => {
    const { executionResult } = await runWithBeforePart(async (ctx) => {
      throw await ctx.fault({
        faultKind: 'executor_raised',
        message: 'never',
        retryable: false,
      });
    });
    expect(!executionResult.ok && executionResult.error.retry).toBeNull();
  });

  it('is refused as not its own where it belongs to another execution', async () => {
    const foreignFault = await (async () => {
      const capturedFaults: ArvoHandlerFault[] = [];
      await runWithBeforePart(async (ctx) => {
        capturedFaults.push(
          await ctx.fault({
            faultKind: 'executor_raised',
            message: 'elsewhere',
          }),
        );
      });
      return capturedFaults[0] as ArvoHandlerFault;
    })();
    const { executionResult } = await runWithBeforePart(() => {
      throw foreignFault;
    });
    expect(!executionResult.ok && executionResult.error.faultKind).toBe(
      'executor_raised',
    );
    expect(!executionResult.ok && executionResult.error.retry).toBeNull();
    expect(!executionResult.ok && executionResult.error.message).toContain(
      'another execution',
    );
  });
});

describe('a before part that writes through the context', () => {
  it('is refused, as the executor would be, where the state is one the schema rejects', async () => {
    const { executionResult, executorSpy } = await runWithBeforePart(
      async (ctx) => {
        await (
          ctx as never as { setState: (stateUpdate: unknown) => Promise<void> }
        ).setState({
          data: { stage: 42 },
        });
      },
    );
    expect(!executionResult.ok && executionResult.error.faultKind).toBe(
      'state_schema_rejected',
    );
    expect(executorSpy).not.toHaveBeenCalled();
  });

  it('cancels, and the executor answering rests the record at cancelled', async () => {
    const { executionResult } = await runWithBeforePart((ctx) => {
      (ctx as never as { cancel: (reason: string) => void }).cancel(
        'tenant suspended',
      );
    });
    expect(
      executionResult.ok &&
        executionResult.value.kind === 'produced' &&
        executionResult.value.state.lifecycle,
    ).toBe('cancelled');
  });

  it('cancels, and the executor not answering is the cancelled fault', async () => {
    const { executionResult } = await runWithBeforePart(
      (ctx) => {
        (ctx as never as { cancel: (reason: string) => void }).cancel(
          'tenant suspended',
        );
      },
      { execute: async () => undefined },
    );
    expect(!executionResult.ok && executionResult.error.faultKind).toBe(
      'execution_cancelled',
    );
  });

  it('may store a value whose own getter writes middleware data, without looping', async () => {
    let seenLazyValue: unknown;
    const { executionResult } = await runWithBeforePart(
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
          seenLazyValue = (ctx.middleware.lazy as { value: string }).value;
          await Promise.resolve();
          expect(ctx.middleware.touched).toBe(true);
          return answeringExecutor(ctx);
        },
      },
    );
    expect(seenLazyValue).toBe('read');
    expect(executionResult.ok).toBe(true);
  });
});

describe('a before part that tries what it may not', () => {
  it('builds and returns an event, which goes nowhere', async () => {
    const { executionResult } = await runWithBeforePart(async (ctx) => {
      return (await ctx.build({
        type: 'com_payment_charge',
        data: { amount: 99 },
      })) as never;
    });
    const producedValue =
      executionResult.ok && executionResult.value.kind === 'produced'
        ? executionResult.value
        : null;
    expect(producedValue?.events.map((event) => event.type)).toEqual([
      'com_order_created',
    ]);
  });

  it('assigns to a frozen member, which fails as the work failing', async () => {
    const { executionResult } = await runWithBeforePart((ctx) => {
      (ctx as unknown as Record<string, unknown>).attempt = 9;
    });
    expect(
      executionResult.ok &&
        executionResult.value.kind === 'produced' &&
        executionResult.value.state.lifecycle,
    ).toBe('error');
  });
});

describe('a before part that never finishes', () => {
  it('runs the clock out as a retryable run timeout, the executor never entered', async () => {
    const { executionResult, executorSpy } = await runWithBeforePart(
      () => new Promise<void>(() => undefined),
      {
        runTimeout: 20,
      },
    );
    expect(!executionResult.ok && executionResult.error.faultKind).toBe(
      'run_timeout',
    );
    expect(!executionResult.ok && executionResult.error.retry).not.toBeNull();
    expect(executorSpy).not.toHaveBeenCalled();
  });

  it('enters nothing after it, even where it finishes once the clock has fired', async () => {
    const { executorSpy, afterSpy } = await runWithBeforePart(() => sleep(50), {
      runTimeout: 15,
    });
    await sleep(70);
    expect(executorSpy).not.toHaveBeenCalled();
    expect(afterSpy).not.toHaveBeenCalled();
  });
});
