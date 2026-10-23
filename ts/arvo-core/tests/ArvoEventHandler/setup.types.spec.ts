import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { setupArvoEventHandler } from '../../src/factories/setupArvoEventHandler.js';
import { orderContract, paymentVersion } from './fixtures.js';

/**
 * What the chain's generics are for.
 *
 * These assertions run, rather than being compile-time only. A helper that
 * merely declared its shape could not reproduce what is being checked here:
 * a type falling back to its default where a declaration names nothing is
 * something `infer` reports as `unknown` rather than consulting the
 * default, so the behaviour only shows up in code that is really compiled
 * and really called.
 */

/** Records what an executor saw, so a type can be asserted on a value. */
const executorObservations: Record<string, unknown> = {};

describe('what an executor is typed to see', () => {
  it('types the state from the schema the version declared', () => {
    setupArvoEventHandler({ contracts: { self: orderContract } }).handler(
      '1.0.0',
      {
        state: z.object({ orderId: z.string() }),
        execute: async (ctx) => {
          const orderId: string | undefined = ctx.state.data?.orderId;
          executorObservations.orderId = orderId;
        },
      },
    );
    expect(executorObservations).toBeDefined();
  });

  it('types the triggering event from the contracts declared', () => {
    setupArvoEventHandler({
      contracts: {
        self: orderContract,
        services: { payments: paymentVersion },
      },
    }).handler('1.0.0', {
      execute: async (ctx) => {
        const triggeringEvent = ctx.state.triggeringEvent;
        if (triggeringEvent.type === 'com_order_create') {
          const items: string[] = triggeringEvent.data.items;
          executorObservations.items = items;
          return;
        }
        if (triggeringEvent.type === 'evt_payment_charged') {
          const receipt: string = triggeringEvent.data.receipt;
          executorObservations.receipt = receipt;
        }
      },
    });
    expect(executorObservations).toBeDefined();
  });

  it('types the dependencies and the hooks from what the declaration named', () => {
    setupArvoEventHandler({
      contracts: { self: orderContract },
      types: {} as {
        dependencies: { db: { read: () => string } };
        mechanismHooks: { scheduler: { at: number } };
      },
    }).handler('1.0.0', {
      execute: async (ctx) => {
        // Declared both and cannot run without either, so it says so
        // per member: what arrived is whatever the mechanism had.
        const db = ctx.dependencies?.db;
        const scheduler = ctx.hooks?.scheduler;
        if (db === undefined || scheduler === undefined) {
          throw new Error('this version was not given what it declared');
        }
        const dbRow: string = db.read();
        const scheduledAt: number = scheduler.at;
        executorObservations.row = dbRow;
        executorObservations.when = scheduledAt;
      },
    });
    expect(executorObservations).toBeDefined();
  });

  it('types a service emission from the contracts declared', () => {
    setupArvoEventHandler({
      contracts: {
        self: orderContract,
        services: { payments: paymentVersion },
      },
    }).handler('1.0.0', {
      execute: async (ctx) =>
        ctx.build({ type: 'com_payment_charge', data: { amount: 10 } }),
    });
    expect(executorObservations).toBeDefined();
  });

  it('types the same way where the executor is declared alone', () => {
    setupArvoEventHandler({
      contracts: {
        self: orderContract,
        services: { payments: paymentVersion },
      },
    }).handler('1.0.0', async (ctx) =>
      ctx.build({ type: 'com_payment_charge', data: { amount: 10 } }),
    );
    expect(executorObservations).toBeDefined();
  });
});

describe('what the chain refuses before anything runs', () => {
  it('refuses a version the contract does not declare', () => {
    setupArvoEventHandler({ contracts: { self: orderContract } }).handler(
      // @ts-expect-error 9.9.9 is not a version com_order_create declares
      '9.9.9',
      async () => {},
    );
    expect(executorObservations).toBeDefined();
  });

  it('refuses an emission of a type nothing declared', () => {
    setupArvoEventHandler({
      contracts: {
        self: orderContract,
        services: { payments: paymentVersion },
      },
    }).handler('1.0.0', {
      execute: async (ctx) =>
        ctx.build({
          // @ts-expect-error nothing this handler declared takes this in
          type: 'com_nothing_declared',
          data: { amount: 10 },
        }),
    });
    expect(executorObservations).toBeDefined();
  });

  it('refuses a payload the declared type does not accept', () => {
    setupArvoEventHandler({
      contracts: {
        self: orderContract,
        services: { payments: paymentVersion },
      },
    }).handler('1.0.0', {
      execute: async (ctx) =>
        ctx.build({
          type: 'com_payment_charge',
          // @ts-expect-error com_payment_charge takes an amount, not a note
          data: { note: 'hello' },
        }),
    });
    expect(executorObservations).toBeDefined();
  });

  it('refuses reaching for a dependency the declaration never named', () => {
    setupArvoEventHandler({ contracts: { self: orderContract } }).handler(
      '1.0.0',
      {
        execute: async (ctx) => {
          // @ts-expect-error nothing declared what a dependency would be
          executorObservations.missing = ctx.dependencies.db;
        },
      },
    );
    expect(executorObservations).toBeDefined();
  });

  it('refuses state a version that declared none has no room for', () => {
    setupArvoEventHandler({ contracts: { self: orderContract } }).handler(
      '1.0.0',
      {
        execute: async (ctx) => {
          // @ts-expect-error this version declared no state to write
          await ctx.setState({ data: { orderId: '1' } });
        },
      },
    );
    expect(executorObservations).toBeDefined();
  });
});

describe('what a declaration may name', () => {
  it('does not take telemetry, which is given with each execution', () => {
    const declare = () =>
      setupArvoEventHandler({
        contracts: { self: orderContract },
        // @ts-expect-error telemetry is given with each execution, not declared
        telemetry: {},
      });
    expect(declare).toBeTypeOf('function');
  });
});
