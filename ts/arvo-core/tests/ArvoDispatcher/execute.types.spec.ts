import { describe, expect, expectTypeOf, it } from 'vitest';
import { ArvoDispatcher } from '../../src/ArvoDispatcher/index.js';
import type { ArvoHandlerFault } from '../../src/ArvoEventHandler/fault/index.js';
import type {
  ArvoEventHandlerExecuteParam,
  ArvoEventHandlerExecuteResponse,
} from '../../src/ArvoEventHandler/types/execute.js';
import type { AsyncResult } from '../../src/types.js';
import {
  dependencyExposing,
  fakeStore,
  orderHandlerUnderTest,
  orderRequest,
  paymentHandlerUnderTest,
} from './execution.js';

/**
 * The type level, run so it compiles where the suite does.
 *
 * Each `@ts-expect-error` is an assertion: if the line stopped being an
 * error, `pnpm typecheck` would fail on the directive itself.
 */

const dispatcher = new ArvoDispatcher({
  handlers: [orderHandlerUnderTest(), paymentHandlerUnderTest()],
});

describe('what the compiler says entering a dispatcher is', () => {
  it('returns exactly what a handler returns', () => {
    expectTypeOf(dispatcher.tryExecute).returns.toEqualTypeOf<
      AsyncResult<ArvoEventHandlerExecuteResponse, ArvoHandlerFault>
    >();
  });

  it('takes the event, state, attempt and telemetry exactly as a handler takes them', () => {
    type Param = Parameters<typeof dispatcher.tryExecute>[0];
    type HandlerParam = ArvoEventHandlerExecuteParam<
      Record<never, never>,
      Record<never, never>
    >;
    expectTypeOf<Param['event']>().toEqualTypeOf<HandlerParam['event']>();
    expectTypeOf<Param['state']>().toEqualTypeOf<HandlerParam['state']>();
    expectTypeOf<Param['attempt']>().toEqualTypeOf<HandlerParam['attempt']>();
    expectTypeOf<Param['telemetry']>().toEqualTypeOf<
      HandlerParam['telemetry']
    >();
  });

  it('keys dependencies by each handler’s type, typed to its declaration', async () => {
    const executed = await dispatcher.tryExecute({
      event: orderRequest(),
      state: fakeStore().read(),
      attempt: 0,
      dependencies: {
        com_order_create: dependencyExposing({ orders: 'the orders table' }),
        com_payment_charge: dependencyExposing({ ledger: 7 }),
      },
    });
    expect(executed.ok).toBe(true);
  });

  it('refuses a dependency of the wrong shape for its handler', async () => {
    const executed = await dispatcher.tryExecute({
      event: orderRequest(),
      state: fakeStore().read(),
      attempt: 0,
      dependencies: {
        // @ts-expect-error the payment handler declares a numeric ledger
        com_payment_charge: dependencyExposing({ ledger: 'seven' }),
      },
    });
    expect(executed.ok).toBe(true);
  });

  it('takes no layers on a call', async () => {
    const executed = await dispatcher.tryExecute({
      event: orderRequest(),
      state: fakeStore().read(),
      attempt: 0,
      // @ts-expect-error layers are fixed when the dispatcher is declared
      middleware: [],
    });
    expect(executed.ok).toBe(true);
  });
});

describe('what the compiler says declaring a dispatcher takes', () => {
  it('does not take telemetry, which is given with each call', () => {
    const declare = () =>
      new ArvoDispatcher({
        handlers: [orderHandlerUnderTest()],
        // @ts-expect-error telemetry is given with each call, not declared
        telemetry: {},
      });
    expect(declare).toBeTypeOf('function');
  });
});
