import { err, ok } from 'neverthrow';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArvoDispatcher } from '../../src/ArvoDispatcher/index.js';
import { ArvoHandlerFault } from '../../src/ArvoEventHandler/fault/index.js';
import { ArvoEventHandler } from '../../src/ArvoEventHandler/index.js';
import type { ArvoEventHandlerExecuteResponse } from '../../src/ArvoEventHandler/types/execute.js';
import type { IArvoEventHandlerMiddleware } from '../../src/ArvoEventHandler/types/middleware.js';
import { mutateArvoEvent } from '../../src/factories/mutateArvoEvent.js';
import { fromNeverthrow } from '../../src/result.js';
import type { Result } from '../../src/types.js';
import {
  dependencyExposing,
  fakeStore,
  orderHandlerUnderTest,
  orderRequest,
  paymentHandlerUnderTest,
  type Seen,
} from './execution.js';

const aFault = (retryable: boolean) =>
  new ArvoHandlerFault({
    faultKind: retryable ? 'run_timeout' : 'record_invalid',
    message: 'the handler refused',
    cause: null,
    violations: [],
    subject: 'order-1',
    executionId: null,
    eventId: 'event-1',
    attempt: 0,
    timestamp: 0,
    retry: retryable
      ? { maxRetryAttemptsAllowed: 3, retryInMs: 10, retryAt: 10 }
      : null,
    abandonmentEvent: null,
    abandonmentState: null,
  });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('entering a dispatcher', () => {
  it('enters the handler the event’s to names, and no other', async () => {
    const order = orderHandlerUnderTest();
    const payment = paymentHandlerUnderTest();
    const entered = vi.spyOn(ArvoEventHandler.prototype, 'tryExecute');
    const dispatcher = new ArvoDispatcher({ handlers: [order, payment] });

    const executed = await dispatcher.tryExecute({
      event: orderRequest(),
      state: fakeStore().read(),
      attempt: 0,
    });

    expect(executed.ok && executed.value.kind).toBe('produced');
    expect(entered.mock.contexts).toEqual([order]);
  });

  it('returns what the handler produced', async () => {
    const dispatcher = new ArvoDispatcher({
      handlers: [orderHandlerUnderTest()],
    });
    const executed = await dispatcher.tryExecute({
      event: orderRequest(),
      state: fakeStore().read(),
      attempt: 0,
    });
    if (!executed.ok || executed.value.kind !== 'produced') {
      throw new Error('expected events and a record');
    }
    expect(executed.value.events.map((event) => event.type)).toEqual([
      'com_payment_charge',
    ]);
  });

  const responses: [
    string,
    Result<ArvoEventHandlerExecuteResponse, ArvoHandlerFault>,
  ][] = [
    [
      'events and a record',
      fromNeverthrow(ok({ kind: 'produced', events: [], state: {} })),
    ],
    [
      'a discard',
      fromNeverthrow(ok({ kind: 'discarded', reason: 'already seen' })),
    ],
    ['a fault', fromNeverthrow(err(aFault(false)))],
  ];

  it.each(responses)(
    'returns %s exactly as the handler returned it',
    async (_name, returned) => {
      const order = orderHandlerUnderTest();
      vi.spyOn(ArvoEventHandler.prototype, 'tryExecute').mockResolvedValue(
        returned,
      );
      const dispatcher = new ArvoDispatcher({ handlers: [order] });
      expect(
        await dispatcher.tryExecute({
          event: orderRequest(),
          state: fakeStore().read(),
          attempt: 0,
        }),
      ).toBe(returned);
    },
  );

  it('gives the picked handler its own dependency entry and nothing of another’s', async () => {
    const seen: Seen[] = [];
    const dispatcher = new ArvoDispatcher({
      handlers: [orderHandlerUnderTest({ seen }), paymentHandlerUnderTest()],
    });
    await dispatcher.tryExecute({
      event: orderRequest(),
      state: fakeStore().read(),
      attempt: 0,
      dependencies: {
        com_order_create: dependencyExposing({ orders: 'the orders table' }),
        com_payment_charge: dependencyExposing({ ledger: 7 }),
      },
    });
    expect(seen).toEqual([{ dependency: 'the orders table', hooks: null }]);
  });

  it('enters the picked handler with no dependencies where none is given for it', async () => {
    const seen: Seen[] = [];
    const dispatcher = new ArvoDispatcher({
      handlers: [orderHandlerUnderTest({ seen }), paymentHandlerUnderTest()],
    });
    await dispatcher.tryExecute({
      event: orderRequest(),
      state: fakeStore().read(),
      attempt: 0,
      dependencies: { com_payment_charge: dependencyExposing({ ledger: 7 }) },
    });
    expect(seen).toEqual([{ dependency: null, hooks: null }]);
  });

  it('never takes an inherited key for a dependency entry', async () => {
    const seen: Seen[] = [];
    const order = orderHandlerUnderTest({ seen });
    const dispatcher = new ArvoDispatcher({ handlers: [order] });
    const inherited = Object.create({
      com_order_create: dependencyExposing({ orders: 'from the prototype' }),
    });
    await dispatcher.tryExecute({
      event: orderRequest(),
      state: fakeStore().read(),
      attempt: 0,
      dependencies: inherited,
    });
    expect(seen).toEqual([{ dependency: null, hooks: null }]);
  });

  it('reads no entry for a type nobody here handles', async () => {
    const dispatcher = new ArvoDispatcher({
      handlers: [orderHandlerUnderTest()],
    });
    const executed = await dispatcher.tryExecute({
      event: orderRequest(),
      state: fakeStore().read(),
      attempt: 0,
      dependencies: {
        // deliberately invalid: a key for a handler not in the set
        com_nowhere: dependencyExposing({ anything: true }),
      } as never,
    });
    expect(executed.ok).toBe(true);
  });

  it('passes the hooks it was given', async () => {
    const seen: Seen[] = [];
    const dispatcher = new ArvoDispatcher({
      handlers: [orderHandlerUnderTest({ seen })],
    });
    await dispatcher.tryExecute({
      event: orderRequest(),
      state: fakeStore().read(),
      attempt: 0,
      hooks: { ticket: 'T-1' },
    });
    expect(seen).toEqual([{ dependency: null, hooks: 'T-1' }]);
  });

  it('supplies the set’s layers, outside the handler’s own', async () => {
    const order: string[] = [];
    const layerLogging = (id: string): IArvoEventHandlerMiddleware => ({
      id,
      before: () => {
        order.push(id);
      },
    });
    const dispatcher = new ArvoDispatcher({
      handlers: [
        orderHandlerUnderTest({ middleware: [layerLogging('declared')] }),
      ],
      middlewares: [layerLogging('supplied')],
    });
    await dispatcher.tryExecute({
      event: orderRequest(),
      state: fakeStore().read(),
      attempt: 0,
    });
    expect(order).toEqual(['supplied', 'declared']);
  });

  it('passes no layers at all where the set has none', async () => {
    const handler = orderHandlerUnderTest();
    const entered = vi.spyOn(ArvoEventHandler.prototype, 'tryExecute');
    await new ArvoDispatcher({ handlers: [handler] }).tryExecute({
      event: orderRequest(),
      state: fakeStore().read(),
      attempt: 0,
    });
    expect(entered.mock.calls[0]?.[0]).not.toHaveProperty('middleware');
    expect(entered.mock.calls[0]?.[0]).not.toHaveProperty('dependencies');
    expect(entered.mock.calls[0]?.[0]).not.toHaveProperty('hooks');
  });

  it('throws from the throwing form what the primitive reported', async () => {
    const order = orderHandlerUnderTest();
    const fault = aFault(false);
    vi.spyOn(ArvoEventHandler.prototype, 'tryExecute').mockResolvedValue(
      fromNeverthrow(err(fault)),
    );
    const dispatcher = new ArvoDispatcher({ handlers: [order] });
    await expect(
      dispatcher.execute({
        event: orderRequest(),
        state: fakeStore().read(),
        attempt: 0,
      }),
    ).rejects.toBe(fault);
  });

  it('returns from the throwing form what the handler produced', async () => {
    const dispatcher = new ArvoDispatcher({
      handlers: [orderHandlerUnderTest()],
    });
    const response = await dispatcher.execute({
      event: orderRequest(),
      state: fakeStore().read(),
      attempt: 0,
    });
    expect(response.kind).toBe('produced');
  });
});

describe('no handler for the event', () => {
  const dispatcher = new ArvoDispatcher({
    handlers: [orderHandlerUnderTest(), paymentHandlerUnderTest()],
  });

  it('refuses a to nobody here handles, entering no handler', async () => {
    const executed = await dispatcher.tryExecute({
      event: orderRequest({ to: 'com_nowhere' }),
      state: fakeStore().read(),
      attempt: 0,
    });
    if (executed.ok) throw new Error('expected a fault');
    expect(executed.error.faultKind).toBe('handler_not_found');
    expect(executed.error.retry).toBeNull();
    expect(executed.error.abandonmentEvent).toBeNull();
    expect(executed.error.abandonmentState).toBeNull();
    expect(executed.error.message).toContain('com_nowhere');
    expect(executed.error.message).toContain('com_order_create');
  });

  it('refuses an event with no to at all', async () => {
    const unaddressed = mutateArvoEvent(orderRequest(), {
      to: null as never, // deliberately invalid: an untyped caller clearing to
    });
    const executed = await dispatcher.tryExecute({
      event: unaddressed,
      state: fakeStore().read(),
      attempt: 0,
    });
    if (executed.ok) throw new Error('expected a fault');
    expect(executed.error.faultKind).toBe('handler_not_found');
    expect(executed.error.message).toContain('carries no to');
  });

  it('refuses the same way at a later attempt', async () => {
    const executed = await dispatcher.tryExecute({
      event: orderRequest({ to: 'com_nowhere' }),
      state: fakeStore().read(),
      attempt: 4,
    });
    if (executed.ok) throw new Error('expected a fault');
    expect(executed.error.faultKind).toBe('handler_not_found');
    expect(executed.error.attempt).toBe(4);
    expect(executed.error.retry).toBeNull();
  });
});

describe('raising only faults, and leaving the mechanism its work', () => {
  it('lets something thrown that is not a fault propagate as thrown', async () => {
    const order = orderHandlerUnderTest();
    const failure = new Error('a bug');
    vi.spyOn(ArvoEventHandler.prototype, 'tryExecute').mockRejectedValue(
      failure,
    );
    await expect(
      new ArvoDispatcher({ handlers: [order] }).tryExecute({
        event: orderRequest(),
        state: fakeStore().read(),
        attempt: 0,
      }),
    ).rejects.toBe(failure);
  });

  it('writes nothing, the state function it was given being only read', async () => {
    const store = fakeStore();
    await new ArvoDispatcher({
      handlers: [orderHandlerUnderTest()],
    }).tryExecute({
      event: orderRequest(),
      state: store.read(),
      attempt: 0,
    });
    expect(store.rows.size).toBe(0);
  });

  it('returns a retryable fault after entering the handler once', async () => {
    const order = orderHandlerUnderTest();
    const fault = aFault(true);
    const entered = vi
      .spyOn(ArvoEventHandler.prototype, 'tryExecute')
      .mockResolvedValue(fromNeverthrow(err(fault)));
    const executed = await new ArvoDispatcher({ handlers: [order] }).tryExecute(
      {
        event: orderRequest(),
        state: fakeStore().read(),
        attempt: 0,
      },
    );
    expect(executed.ok ? null : executed.error).toBe(fault);
    expect(entered).toHaveBeenCalledTimes(1);
  });

  it('returns a repeated init’s fault as it is', async () => {
    const order = orderHandlerUnderTest();
    const repeated = new ArvoHandlerFault({
      ...aFault(false),
      faultKind: 'record_unexpected',
      message: 'an init arrived with a record',
      violations: [],
      cause: null,
    });
    vi.spyOn(ArvoEventHandler.prototype, 'tryExecute').mockResolvedValue(
      fromNeverthrow(err(repeated)),
    );
    const executed = await new ArvoDispatcher({ handlers: [order] }).tryExecute(
      {
        event: orderRequest(),
        state: fakeStore().read(),
        attempt: 0,
      },
    );
    expect(executed.ok ? null : executed.error).toBe(repeated);
  });

  it('carries nothing from one call into the next', async () => {
    const seen: Seen[] = [];
    const dispatcher = new ArvoDispatcher({
      handlers: [orderHandlerUnderTest({ seen })],
    });
    await dispatcher.tryExecute({
      event: orderRequest({ subject: 'order-1' }),
      state: fakeStore().read(),
      attempt: 0,
      hooks: { ticket: 'first' },
    });
    await dispatcher.tryExecute({
      event: orderRequest({ subject: 'order-2' }),
      state: fakeStore().read(),
      attempt: 0,
    });
    expect(seen).toEqual([
      { dependency: null, hooks: 'first' },
      { dependency: null, hooks: null },
    ]);
  });
});
