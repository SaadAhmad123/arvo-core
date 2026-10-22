import { trace } from '@opentelemetry/api';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ArvoDispatcher } from '../../src/ArvoDispatcher/index.js';
import { setupArvoEventHandler } from '../../src/factories/setupArvoEventHandler.js';
import { paymentContract } from '../ArvoEventHandler/fixtures.js';
import {
  auditContract,
  auditHandler,
  orderHandler,
  paymentHandler,
} from './fixtures.js';

const handlerWithRunTimeout = (
  contract: typeof paymentContract | typeof auditContract,
  runTimeout: number | null,
) =>
  setupArvoEventHandler({
    contracts: { self: contract },
    options: { runTimeout },
  })
    .handler('1.0.0', {
      state: z.object({ done: z.boolean() }),
      execute: async (ctx) => {
        await ctx.setState({ data: { done: true } });
      },
    })
    .build();

describe('asking a dispatcher about its set', () => {
  const dispatcher = new ArvoDispatcher({
    handlers: [orderHandler(), paymentHandler()],
  });

  it('says a type is handled where a handler implements it', () => {
    expect(dispatcher.handles('com_order_create')).toBe(true);
  });

  it('says a type is not handled where none implements it', () => {
    expect(dispatcher.handles('com_nowhere')).toBe(false);
  });

  it('never handles an absent value', () => {
    expect(dispatcher.handles(null)).toBe(false);
  });

  it('reports the longest run timeout any version declares', () => {
    const timed = new ArvoDispatcher({
      handlers: [
        handlerWithRunTimeout(paymentContract, 2_000),
        handlerWithRunTimeout(auditContract, 9_000),
      ],
    });
    expect(timed.longestRunTimeoutMs).toBe(9_000);
  });

  it('counts a version that inherits the default at the default', () => {
    const inherited = orderHandler();
    const [version] = [...inherited.versions.values()];
    expect(
      new ArvoDispatcher({ handlers: [inherited] }).longestRunTimeoutMs,
    ).toBe(version?.options.runTimeout ?? null);
  });

  it('reports that none is declared where no version declares one', () => {
    const untimed = new ArvoDispatcher({
      handlers: [
        handlerWithRunTimeout(paymentContract, null),
        handlerWithRunTimeout(auditContract, null),
      ],
    });
    expect(untimed.longestRunTimeoutMs).toBeNull();
  });

  it('skips a version with none beside one that declares one', () => {
    const mixed = new ArvoDispatcher({
      handlers: [
        handlerWithRunTimeout(paymentContract, null),
        handlerWithRunTimeout(auditContract, 4_000),
      ],
    });
    expect(mixed.longestRunTimeoutMs).toBe(4_000);
  });
});

describe('the telemetry a dispatcher records with', () => {
  it('takes the tracer, meter and logger it was given', () => {
    const tracer = trace.getTracer('given');
    const logger = { emit: () => undefined };
    const dispatcher = new ArvoDispatcher({
      handlers: [auditHandler()],
      telemetry: { tracer, logger },
    });
    expect(dispatcher.telemetry.tracer).toBe(tracer);
    expect(dispatcher.telemetry.logger).toBe(logger);
    expect(dispatcher.telemetry.meter).toBeNull();
  });

  it('records through the global tracer, with no meter or logger, where none is given', () => {
    const { telemetry } = new ArvoDispatcher({ handlers: [auditHandler()] });
    expect(telemetry.tracer).toBeDefined();
    expect(telemetry.meter).toBeNull();
    expect(telemetry.logger).toBeNull();
  });
});
