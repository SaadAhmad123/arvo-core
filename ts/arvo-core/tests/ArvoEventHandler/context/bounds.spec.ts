import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ArvoExecutionContext } from '../../../src/ArvoEventHandler/context/index.js';
import type { ArvoExecutionContextParam } from '../../../src/ArvoEventHandler/context/types.js';
import { ARVO_DEFAULT_HANDLER_OPTIONS } from '../../../src/ArvoEventHandler/helpers/defaults.js';
import { createInitArvoExecutionState } from '../../../src/ArvoEventHandler/state/factory.js';
import type { ArvoEventHandlerOptions } from '../../../src/ArvoEventHandler/types/options.js';
import type {
  ArvoDependencies,
  ArvoMechanismHooks,
} from '../../../src/ArvoEventHandler/types/supplied.js';
import {
  initEvent,
  orderVersion,
  placeholderIdempotencyKeys,
  services,
  telemetry,
} from '../fixtures.js';

/** What an execution records against; these tests only carry it. */
const { telemetry: sharedTelemetry } = telemetry();

const orderData = z.object({ orderId: z.string(), attempts: z.number() });

const EXECUTION_ID = 'a'.repeat(64);

type InitOverrides = Partial<
  ArvoExecutionContextParam<
    typeof orderVersion,
    typeof services,
    typeof orderData,
    ArvoDependencies,
    ArvoMechanismHooks
  >
>;

const openingContext = (overrides: InitOverrides = {}) => {
  const stateCreation = createInitArvoExecutionState<
    typeof orderVersion,
    typeof services,
    typeof orderData
  >({
    self: orderVersion,
    event: initEvent,
    executionId: EXECUTION_ID,
    parentExecutionId: initEvent.executionid,
  });
  if (!stateCreation.ok) throw stateCreation.error;
  return new ArvoExecutionContext({
    contracts: { self: orderVersion, services },
    state: stateCreation.value,
    entry: 'init',
    dataSchema: orderData,
    attempt: 0,
    telemetry: sharedTelemetry,
    options: ARVO_DEFAULT_HANDLER_OPTIONS,
    idempotency: placeholderIdempotencyKeys,
    dependencies: {},
    hooks: {},
    ...overrides,
  });
};

/** The resolved options, with the bounds a test cares about replaced. */
const boundedOptions = (
  overrides: Partial<ArvoEventHandlerOptions>,
): ArvoEventHandlerOptions => ({
  ...ARVO_DEFAULT_HANDLER_OPTIONS,
  ...overrides,
});

describe('seeing the depth limit before crossing it', () => {
  it('says there is room where the execution sits well short', () => {
    expect(
      openingContext({ options: boundedOptions({ maxDepth: 10 }) }).atMaxDepth,
    ).toBe(false);
  });

  it('says there is none where one more step would reach the maximum', () => {
    expect(
      openingContext({ options: boundedOptions({ maxDepth: 1 }) }).atMaxDepth,
    ).toBe(true);
  });

  it('says there is none where the execution already sits at the maximum', () => {
    expect(
      openingContext({ options: boundedOptions({ maxDepth: 0 }) }).atMaxDepth,
    ).toBe(true);
  });

  it('is judged against what a service emission would carry, not this depth', () => {
    // This execution sits at 0, so an emission would sit at 1: room under a
    // maximum of 2, none under a maximum of 1.
    expect(
      openingContext({ options: boundedOptions({ maxDepth: 2 }) }).atMaxDepth,
    ).toBe(false);
    expect(
      openingContext({ options: boundedOptions({ maxDepth: 1 }) }).atMaxDepth,
    ).toBe(true);
  });
});

describe('how long an executor has left', () => {
  describe('the clock on this attempt', () => {
    it('starts at the whole run timeout, the clock starting where the executor does', () => {
      const ctx = openingContext({
        options: boundedOptions({ runTimeout: 10_000 }),
      });
      expect(ctx.timeRemaining.run).toBeLessThanOrEqual(10_000);
      expect(ctx.timeRemaining.run).toBeGreaterThan(9_900);
    });

    it('counts from the moment the executor was entered', () => {
      const timeBefore = Date.now();
      const ctx = openingContext();
      expect(ctx.enteredAt).toBeGreaterThanOrEqual(timeBefore);
      expect(ctx.enteredAt).toBeLessThanOrEqual(Date.now());
    });

    it('falls as the executor runs', async () => {
      const ctx = openingContext({
        options: boundedOptions({ runTimeout: 10_000 }),
      });
      const runRemainingBefore = ctx.timeRemaining.run as number;
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(ctx.timeRemaining.run as number).toBeLessThan(runRemainingBefore);
    });

    it('goes negative once the attempt has overrun', async () => {
      const ctx = openingContext({
        options: boundedOptions({ runTimeout: 1, executionTimeout: 1 }),
      });
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(ctx.timeRemaining.run as number).toBeLessThan(0);
    });

    it('is unbounded where the version set no run timeout', () => {
      const ctx = openingContext({
        options: boundedOptions({ runTimeout: null, executionTimeout: null }),
      });
      expect(ctx.timeRemaining.run).toBeNull();
    });
  });

  describe('the clock on the whole execution', () => {
    it('is unbounded where the version set none', () => {
      expect(openingContext().timeRemaining.execution).toBeNull();
    });

    it('is what is left of it, measured from the event that opened it', () => {
      const ctx = openingContext({
        options: boundedOptions({
          runTimeout: 1_000,
          executionTimeout: 3_600_000,
        }),
      });
      const elapsed = Date.now() - Date.parse(initEvent.time);
      expect(ctx.timeRemaining.execution).toBeLessThanOrEqual(
        3_600_000 - elapsed,
      );
      expect(ctx.timeRemaining.execution).toBeGreaterThan(
        3_600_000 - elapsed - 5_000,
      );
    });

    it('is negative where the execution has already outlived it', () => {
      const ctx = openingContext({
        options: boundedOptions({ runTimeout: 1, executionTimeout: 1 }),
      });
      expect(ctx.timeRemaining.execution as number).toBeLessThan(0);
    });
  });

  it('is read afresh on every call, so a long executor sees it fall', async () => {
    const ctx = openingContext({
      options: boundedOptions({
        runTimeout: 10_000,
        executionTimeout: 3_600_000,
      }),
    });
    const remainingBefore = ctx.timeRemaining;
    await new Promise((resolve) => setTimeout(resolve, 25));
    const remainingAfter = ctx.timeRemaining;

    expect(remainingAfter.run as number).toBeLessThan(
      remainingBefore.run as number,
    );
    expect(remainingAfter.execution as number).toBeLessThan(
      remainingBefore.execution as number,
    );
  });

  it('cannot be replaced by an executor', () => {
    const ctx = openingContext();
    expect(() => {
      (ctx as unknown as Record<string, unknown>).timeRemaining = {};
    }).toThrow();
    expect(() => {
      (ctx as unknown as Record<string, unknown>).enteredAt = 0;
    }).toThrow();
  });
});

describe('ending an execution deliberately', () => {
  it('leaves it at rest', () => {
    const ctx = openingContext();
    ctx.cancel('the customer withdrew the order');
    expect(ctx.state.lifecycle).toBe('cancelled');
  });

  it('carries the reason on what it remembers', () => {
    const ctx = openingContext();
    ctx.cancel('the customer withdrew the order');
    expect(ctx.state.lifecycleDescription).toBe(
      'the customer withdrew the order',
    );
  });

  it('mints a new record rather than changing the one it had', () => {
    const ctx = openingContext();
    const stateBefore = ctx.state;
    ctx.cancel('no longer wanted');
    expect(ctx.state).not.toBe(stateBefore);
    expect(stateBefore.lifecycle).toBe('idle');
  });

  it('leaves everything else as the execution stood', async () => {
    const ctx = openingContext();
    await ctx.setState({ data: { orderId: 'o-1', attempts: 1 } });
    const stateBefore = ctx.state;
    ctx.cancel('no longer wanted');

    expect(ctx.state.data).toEqual(stateBefore.data);
    expect(ctx.state.executionId).toBe(stateBefore.executionId);
    expect(ctx.state.eventIds).toEqual(stateBefore.eventIds);
    expect(ctx.state.casVersion).toBe(stateBefore.casVersion);
  });
});
