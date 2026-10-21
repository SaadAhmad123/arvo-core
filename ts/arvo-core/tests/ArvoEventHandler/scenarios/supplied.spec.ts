import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { IArvoEventHandlerDependency } from '../../../src/ArvoEventHandler/types/dependency.js';
import { createArvoEventFactory } from '../../../src/factories/ArvoEventFactory/index.js';
import { setupArvoEventHandler } from '../../../src/factories/setupArvoEventHandler.js';
import type { JSONObject } from '../../../src/types.js';
import {
  failingToClose,
  heldDependencies,
  openedPerExecution,
} from '../dependency.js';
import {
  fulfilContract,
  fulfilV1,
  inventoryV1,
  type ScenarioDependencies,
} from './fixture.js';
import { ScenarioStore } from './store.js';

/**
 * What a mechanism supplies, and what the protocol says about it.
 *
 * Three things arrive with every execution and belong to nobody else:
 * the way to reach a store, whatever the executor is given to work
 * with, and whatever the mechanism chooses to expose. None is part of
 * the model, so none can be checked by a schema — which is exactly why
 * each has rules, and why they are worth proving rather than assuming.
 */

/** What each execution saw, so a rule about it can be asserted. */
type Observations = {
  dependencies: unknown[];
  hooks: unknown[];
  resolverCalls: {
    executionId: string;
    attempt: number;
    hadTelemetry: boolean;
  }[];
  factoryCalls: {
    event: string;
    state: unknown;
    executionId: string;
    attempt: number;
  }[];
};

const noObservations = (): Observations => ({
  dependencies: [],
  hooks: [],
  resolverCalls: [],
  factoryCalls: [],
});

/** A handler whose executor records everything it was handed. */
const recordingHandler = (observations: Observations) =>
  setupArvoEventHandler({
    contracts: { self: fulfilContract, services: { inventory: inventoryV1 } },
    types: {} as {
      dependencies: ScenarioDependencies;
      mechanismHooks: Record<string, unknown>;
    },
  })
    .handler('1.0.0', {
      state: z.object({ stage: z.string() }),
      execute: async (ctx) => {
        observations.dependencies.push(ctx.dependencies);
        observations.hooks.push(ctx.hooks);
        await ctx.setState({ data: { stage: 'asking' } });
        return ctx.build({
          type: 'com_inventory_reserve',
          data: { items: ['book'] },
        });
      },
    })
    .handler('1.1.0', {
      state: z.object({ stage: z.string(), rush: z.boolean() }),
      execute: async () => {},
    })
    .handler('2.0.0', async (ctx) => {
      observations.dependencies.push(ctx.dependencies);
      observations.hooks.push(ctx.hooks);
      return ctx.build({
        type: 'evt_order_shipped',
        data: { tracking: 't-1' },
      });
    })
    .build();

const anOrder = (subject = 'order-1') =>
  createArvoEventFactory(fulfilV1).createInput({
    source: 'com.web.checkout',
    subject,
    to: fulfilContract.type,
    data: { items: ['book'] },
  });

/** A store that records what it was asked, and by whom. */
const watchedStore = (observations: Observations) => {
  const store = new ScenarioStore();
  return {
    store,
    resolver: (param: {
      executionId: string;
      attempt: number;
      telemetry: unknown;
    }) => {
      observations.resolverCalls.push({
        executionId: param.executionId,
        attempt: param.attempt,
        hadTelemetry: param.telemetry !== undefined,
      });
      return store.rows.get(param.executionId) ?? null;
    },
  };
};

const inventoryAnswer = (
  openingOutcome: { state: JSONObject; events: readonly { id: string }[] },
  subject = 'order-1',
) =>
  createArvoEventFactory(inventoryV1).createOutput({
    type: 'evt_inventory_reserved',
    source: inventoryV1.type,
    subject,
    to: fulfilContract.type,
    executionid: String(openingOutcome.state.executionId),
    initid: openingOutcome.events[0]?.id,
    parentid: openingOutcome.events[0]?.id,
    data: { held: 1 },
  });

describe('the way a handler reaches a store', () => {
  it('is asked once per execution, under one identifier', async () => {
    const observations = noObservations();
    const { store, resolver } = watchedStore(observations);
    const handler = recordingHandler(observations);

    const openingOutcome = await handler.execute({
      event: anOrder(),
      state: resolver,
      attempt: 0,
    });
    if (openingOutcome.kind !== 'produced')
      throw new Error('nothing was opened');

    expect(observations.resolverCalls).toHaveLength(1);
    expect(observations.resolverCalls[0]?.executionId).toBe(
      String(openingOutcome.state.executionId),
    );
    store.commit(openingOutcome.state);
  });

  it('is told which attempt it is, so it may read differently on a retry', async () => {
    const observations = noObservations();
    const { resolver } = watchedStore(observations);
    await recordingHandler(observations).execute({
      event: anOrder(),
      state: resolver,
      attempt: 3,
    });
    expect(observations.resolverCalls[0]?.attempt).toBe(3);
  });

  it('is given somewhere to record, so the read is part of the execution', async () => {
    const observations = noObservations();
    const { resolver } = watchedStore(observations);
    await recordingHandler(observations).execute({
      event: anOrder(),
      state: resolver,
      attempt: 0,
    });
    expect(observations.resolverCalls[0]?.hadTelemetry).toBe(true);
  });

  it('is asked again on the next execution, never answered from before', async () => {
    const observations = noObservations();
    const { store, resolver } = watchedStore(observations);
    const handler = recordingHandler(observations);

    const openingOutcome = await handler.execute({
      event: anOrder(),
      state: resolver,
      attempt: 0,
    });
    if (openingOutcome.kind !== 'produced')
      throw new Error('nothing was opened');
    store.commit(openingOutcome.state);

    await handler.execute({
      event: inventoryAnswer(openingOutcome),
      state: resolver,
      attempt: 0,
    });
    expect(observations.resolverCalls).toHaveLength(2);
  });

  it('refuses a row that is not an object at all', async () => {
    const handler = recordingHandler(noObservations());
    for (const notARow of ['a string', 7, true, []]) {
      const refusal = await handler.tryExecute({
        event: anOrder(),
        state: () => notARow as unknown as JSONObject,
        attempt: 0,
      });
      expect(
        !refusal.ok && refusal.error.faultKind,
        `${JSON.stringify(notARow)} was not refused`,
      ).toBe('record_unexpected');
    }
  });
});

describe('what an executor is given to work with', () => {
  it('is absence where nothing was supplied, and says so', async () => {
    const observations = noObservations();
    const { resolver } = watchedStore(observations);
    await recordingHandler(observations).execute({
      event: anOrder(),
      state: resolver,
      attempt: 0,
    });
    // not an empty object standing in for one: a version that declared
    // something and was given none must be able to tell
    expect(observations.dependencies[0]).toBeNull();
  });

  it('is what the dependency exposes, and not the dependency', async () => {
    const observations = noObservations();
    const { resolver } = watchedStore(observations);
    const suppliedDependencies = {
      note: 'given',
    } as unknown as ScenarioDependencies;
    const { dependency } = heldDependencies(suppliedDependencies);

    await recordingHandler(observations).execute({
      event: anOrder(),
      state: resolver,
      attempt: 0,
      dependencies: dependency,
    });

    // what it exposes, so an executor cannot reach the lifetime
    expect(observations.dependencies[0]).toBe(suppliedDependencies);
    expect(observations.dependencies[0]).not.toBe(dependency);
    expect(observations.dependencies[0]).not.toHaveProperty('open');
    expect(observations.dependencies[0]).not.toHaveProperty('close');
  });

  it('is opened exactly once for one execution, before the executor', async () => {
    const observations = noObservations();
    const { resolver } = watchedStore(observations);
    const { dependency, calls } = openedPerExecution(
      () => ({ note: 'built' }) as unknown as ScenarioDependencies,
    );

    await recordingHandler(observations).execute({
      event: anOrder(),
      state: resolver,
      attempt: 0,
      dependencies: dependency,
    });

    expect(calls.opened).toHaveLength(1);
    // the executor read it, so it was open by the time it ran
    expect(observations.dependencies[0]).toEqual({ note: 'built' });
  });

  it('is closed exactly once, after the execution has produced its record', async () => {
    const observations = noObservations();
    const { resolver } = watchedStore(observations);
    const { dependency, calls } = openedPerExecution(
      () => ({ note: 'built' }) as unknown as ScenarioDependencies,
    );

    const outcome = await recordingHandler(observations).execute({
      event: anOrder(),
      state: resolver,
      attempt: 0,
      dependencies: dependency,
    });

    expect(outcome.kind).toBe('produced');
    expect(calls.closed).toHaveLength(1);
  });

  it('costs the execution nothing where it cannot be let go of', async () => {
    // Closing happens after the work is done and the record is built,
    // so a failure to close has nothing left to spoil. It is recorded
    // on the span and goes no further — the caller is told what the
    // execution produced, not that a connection would not go back.
    const observations = noObservations();
    const { resolver } = watchedStore(observations);
    const { dependency, calls } = failingToClose(
      { note: 'built' } as unknown as ScenarioDependencies,
      new Error('the pool had already gone'),
    );

    const outcome = await recordingHandler(observations).tryExecute({
      event: anOrder(),
      state: resolver,
      attempt: 0,
      dependencies: dependency,
    });

    expect(outcome.ok && outcome.value.kind).toBe('produced');
    expect(calls.closed).toHaveLength(1);
  });

  it('is opened again for the next execution, never kept from the last', async () => {
    const observations = noObservations();
    const { store, resolver } = watchedStore(observations);
    const handler = recordingHandler(observations);
    let openCount = 0;

    const { dependency } = openedPerExecution(() => {
      openCount += 1;
      return { note: `built-${openCount}` } as unknown as ScenarioDependencies;
    });

    const openingOutcome = await handler.execute({
      event: anOrder(),
      state: resolver,
      attempt: 0,
      dependencies: dependency,
    });
    if (openingOutcome.kind !== 'produced')
      throw new Error('nothing was opened');
    store.commit(openingOutcome.state);

    await handler.execute({
      event: inventoryAnswer(openingOutcome),
      state: resolver,
      attempt: 0,
      dependencies: dependency,
    });

    // the same object twice, and a different thing held each time —
    // which is why a supplier may keep the object and must not keep
    // what it holds
    expect(openCount).toBe(2);
    expect(observations.dependencies[0]).not.toBe(observations.dependencies[1]);
  });

  it('is told what caused this execution, and which attempt it is', async () => {
    const observations = noObservations();
    const { resolver } = watchedStore(observations);
    const order = anOrder();
    const { dependency, calls } = openedPerExecution(
      () => ({}) as unknown as ScenarioDependencies,
    );

    await recordingHandler(observations).execute({
      event: order,
      state: resolver,
      attempt: 2,
      dependencies: dependency,
    });

    expect(calls.opened[0]?.event.id).toBe(order.id);
    expect(calls.opened[0]?.attempt).toBe(2);
  });

  it('is told the execution it is for, and where that execution records', async () => {
    const observations = noObservations();
    const { resolver } = watchedStore(observations);
    const { dependency, calls } = openedPerExecution(
      () => ({}) as unknown as ScenarioDependencies,
    );

    const outcome = await recordingHandler(observations).execute({
      event: anOrder(),
      state: resolver,
      attempt: 0,
      dependencies: dependency,
    });
    if (outcome.kind !== 'produced') throw new Error('nothing was produced');

    expect(calls.opened[0]?.executionId).toBe(outcome.state.executionId);
    expect(calls.opened[0]?.telemetry).toBeDefined();
    // closed for the same execution it was opened for
    expect(calls.closed[0]?.executionId).toBe(outcome.state.executionId);
  });

  it('sees absence where the execution had no record yet, and the record where it did', async () => {
    const observations = noObservations();
    const { store, resolver } = watchedStore(observations);
    const handler = recordingHandler(observations);
    const { dependency, calls } = openedPerExecution(
      () => ({}) as unknown as ScenarioDependencies,
    );

    const openingOutcome = await handler.execute({
      event: anOrder(),
      state: resolver,
      attempt: 0,
      dependencies: dependency,
    });
    if (openingOutcome.kind !== 'produced')
      throw new Error('nothing was opened');
    store.commit(openingOutcome.state);

    await handler.execute({
      event: inventoryAnswer(openingOutcome),
      state: resolver,
      attempt: 0,
      dependencies: dependency,
    });

    expect(calls.opened[0]?.state).toBeNull();
    expect(calls.opened[1]?.state).not.toBeNull();
  });
});

describe('whatever the mechanism exposes to an executor', () => {
  it('is absence where nothing was exposed, and says so', async () => {
    const observations = noObservations();
    const { resolver } = watchedStore(observations);
    await recordingHandler(observations).execute({
      event: anOrder(),
      state: resolver,
      attempt: 0,
    });
    expect(observations.hooks[0]).toBeNull();
  });

  it('is passed through exactly as it was given, uninterpreted', async () => {
    const observations = noObservations();
    const { resolver } = watchedStore(observations);
    const exposedHooks = { scheduler: { at: 1 }, whatever: Symbol('opaque') };

    await recordingHandler(observations).execute({
      event: anOrder(),
      state: resolver,
      attempt: 0,
      hooks: exposedHooks,
    });
    expect(observations.hooks[0]).toBe(exposedHooks);
  });

  it('is passed through even where it is not an object at all', async () => {
    const observations = noObservations();
    const { resolver } = watchedStore(observations);
    await recordingHandler(observations).execute({
      event: anOrder(),
      state: resolver,
      attempt: 0,
      hooks: 'whatever this mechanism means' as never,
    });
    expect(observations.hooks[0]).toBe('whatever this mechanism means');
  });

  it('never reaches the record either', async () => {
    const observations = noObservations();
    const { resolver } = watchedStore(observations);
    const outcome = await recordingHandler(observations).execute({
      event: anOrder(),
      state: resolver,
      attempt: 0,
      hooks: { secret: 'nothing may store this' },
    });
    if (outcome.kind !== 'produced') throw new Error('nothing was opened');
    expect(JSON.stringify(outcome.state)).not.toContain(
      'nothing may store this',
    );
  });

  it('is the executor s problem where reading one fails', async () => {
    const handler = setupArvoEventHandler({
      contracts: { self: fulfilContract },
      types: {} as { mechanismHooks: { brittle: string } },
    })
      .handler('1.0.0', {
        state: z.object({ stage: z.string() }),
        execute: async (ctx) => {
          await ctx.setState({ data: { stage: 'reading' } });
          return ctx.build({
            type: 'evt_order_fulfilled',
            data: { order_id: String(ctx.hooks?.brittle) },
          });
        },
      })
      .handler('1.1.0', {
        state: z.object({ stage: z.string(), rush: z.boolean() }),
        execute: async () => {},
      })
      .handler('2.0.0', async () => {})
      .build();

    const brittleHooks = {} as { brittle: string };
    Object.defineProperty(brittleHooks, 'brittle', {
      get() {
        throw new Error('this hook cannot be read');
      },
    });

    // the work failed, which is a conclusion rather than a fault
    const outcome = await handler.execute({
      event: anOrder(),
      state: new ScenarioStore().resolver,
      attempt: 0,
      hooks: brittleHooks,
    });
    expect(outcome.kind).toBe('produced');
    expect(outcome.kind === 'produced' && outcome.state.lifecycle).toBe(
      'error',
    );
    expect(outcome.kind === 'produced' && outcome.events[0]?.type).toBe(
      fulfilV1.error.type,
    );
  });
});

describe('what one execution cannot leave behind for the next', () => {
  it('holds nothing of what it was supplied, across three executions', async () => {
    const observations = noObservations();
    const { store, resolver } = watchedStore(observations);
    const handler = recordingHandler(observations);

    for (const subject of ['order-a', 'order-b', 'order-c']) {
      const outcome = await handler.execute({
        event: anOrder(subject),
        state: resolver,
        attempt: 0,
        dependencies: heldDependencies({
          note: subject,
        } as unknown as ScenarioDependencies).dependency,
        hooks: { ticket: subject },
      });
      if (outcome.kind === 'produced') store.commit(outcome.state);
    }

    expect(observations.dependencies).toEqual([
      { note: 'order-a' },
      { note: 'order-b' },
      { note: 'order-c' },
    ]);
    expect(observations.hooks).toEqual([
      { ticket: 'order-a' },
      { ticket: 'order-b' },
      { ticket: 'order-c' },
    ]);
  });

  it('holds nothing of either on the handler itself', async () => {
    const observations = noObservations();
    const { resolver } = watchedStore(observations);
    const handler = recordingHandler(observations);

    await handler.execute({
      event: anOrder(),
      state: resolver,
      attempt: 0,
      dependencies: heldDependencies({
        note: 'given',
      } as unknown as ScenarioDependencies).dependency,
      hooks: { ticket: 'T-1' },
    });

    expect(JSON.stringify(handler.contracts)).not.toContain('given');
    expect(Object.keys(handler)).not.toContain('dependencies');
    expect(Object.keys(handler)).not.toContain('hooks');
  });
});

describe('what an executor is told where nothing was supplied', () => {
  /**
   * A mechanism routes an event to whichever handler it names, so it
   * cannot be held to a declaration it has not seen. Absence stays
   * possible, and the only honest thing is to say so where it can be
   * acted on — which is the executor, the one party that knows whether
   * it can work without what it asked for.
   */

  /** A handler whose executor refuses to run without what it declared. */
  const strictHandler = () =>
    setupArvoEventHandler({
      contracts: { self: fulfilContract, services: { inventory: inventoryV1 } },
      types: {} as {
        dependencies: ScenarioDependencies;
        mechanismHooks: { ticket: string };
      },
    })
      .handler('1.0.0', {
        state: z.object({ stage: z.string() }),
        execute: async (ctx) => {
          if (ctx.dependencies === null) {
            throw await ctx.fault({
              faultKind: 'executor_raised',
              message: 'this version needs a catalogue and was given none',
              retryable: false,
            });
          }
          await ctx.setState({ data: { stage: 'asking' } });
          return ctx.build({
            type: 'com_inventory_reserve',
            data: { items: ['book'] },
          });
        },
      })
      .handler('1.1.0', {
        state: z.object({ stage: z.string(), rush: z.boolean() }),
        execute: async () => {},
      })
      .handler('2.0.0', async (ctx) =>
        ctx.build({ type: 'evt_order_shipped', data: { tracking: 't-1' } }),
      )
      .build();

  /** A handler whose executor works either way, and records which. */
  const degradingHandler = (observations: { had: (boolean | null)[] }) =>
    setupArvoEventHandler({
      contracts: { self: fulfilContract, services: { inventory: inventoryV1 } },
      types: {} as {
        dependencies: ScenarioDependencies;
        mechanismHooks: { ticket: string };
      },
    })
      .handler('1.0.0', {
        state: z.object({ stage: z.string() }),
        execute: async (ctx) => {
          observations.had.push(ctx.dependencies !== null);
          await ctx.setState({ data: { stage: 'asking' } });
          return ctx.build({
            type: 'com_inventory_reserve',
            data: { items: ['book'] },
          });
        },
      })
      .handler('1.1.0', {
        state: z.object({ stage: z.string(), rush: z.boolean() }),
        execute: async () => {},
      })
      .handler('2.0.0', async (ctx) =>
        ctx.build({ type: 'evt_order_shipped', data: { tracking: 't-1' } }),
      )
      .build();

  it('reads absence where a declared dependency was not supplied', async () => {
    const observations = { had: [] as (boolean | null)[] };
    const { resolver } = watchedStore(noObservations());

    const outcome = await degradingHandler(observations).execute({
      event: anOrder(),
      state: resolver,
      attempt: 0,
    });

    // entered, not refused: the protocol does not decide this
    expect(outcome.kind).toBe('produced');
    expect(observations.had[0]).toBe(false);
  });

  it('lets an executor that cannot proceed fail, naming what was missing', async () => {
    const { resolver } = watchedStore(noObservations());

    const refusal = await strictHandler().tryExecute({
      event: anOrder(),
      state: resolver,
      attempt: 0,
    });

    expect(refusal.ok).toBe(false);
    if (refusal.ok) return;
    expect(refusal.error.faultKind).toBe('executor_raised');
    expect(refusal.error.message).toContain('needs a catalogue');
    // its own choice, so no further attempt is in prospect
    expect(refusal.error.retry).toBeNull();
  });

  it('lets an executor that can proceed carry on', async () => {
    const observations = { had: [] as (boolean | null)[] };
    const { resolver } = watchedStore(noObservations());
    const suppliedDependency = heldDependencies(
      {} as ScenarioDependencies,
    ).dependency;

    const outcome = await degradingHandler(observations).execute({
      event: anOrder(),
      state: resolver,
      attempt: 0,
      dependencies: suppliedDependency,
    });

    expect(outcome.kind).toBe('produced');
    expect(observations.had[0]).toBe(true);
  });

  it('reads absence where the mechanism exposed nothing', async () => {
    const observations = noObservations();
    const { resolver } = watchedStore(observations);

    await recordingHandler(observations).execute({
      event: anOrder(),
      state: resolver,
      attempt: 0,
    });

    expect(observations.hooks[0]).toBeNull();
  });

  it('reads a declared member that was not supplied as absent', async () => {
    /**
     * A mechanism hands what it has to whichever handler an event names,
     * so part of a declaration arriving is the ordinary case rather than
     * an edge. A member that did not arrive is absent for the same
     * reason the whole thing can be.
     */
    const observations = { had: [] as (boolean | null)[] };
    const { resolver } = watchedStore(noObservations());

    const partialDependency = heldDependencies({
      behave: undefined,
    } as ScenarioDependencies).dependency;

    const outcome = await degradingHandler(observations).execute({
      event: anOrder(),
      state: resolver,
      attempt: 0,
      dependencies: partialDependency,
    });

    // the object arrived, so this is not the null case
    expect(outcome.kind).toBe('produced');
    expect(observations.had[0]).toBe(true);
  });

  it('lets an executor decide per member, not once for the whole', async () => {
    const optionalMembers: (string | undefined)[] = [];
    const { resolver } = watchedStore(noObservations());

    const handler = setupArvoEventHandler({
      contracts: {
        self: fulfilContract,
        services: { inventory: inventoryV1 },
      },
      types: {} as {
        dependencies: { needed: string; optional?: string };
      },
    })
      .handler('1.0.0', {
        state: z.object({ stage: z.string() }),
        execute: async (ctx) => {
          // one it cannot do without
          if (ctx.dependencies?.needed === undefined) {
            throw await ctx.fault({
              faultKind: 'executor_raised',
              message: 'this version needs `needed` and was given none',
              retryable: false,
            });
          }
          // and one it can
          optionalMembers.push(ctx.dependencies.optional);
          await ctx.setState({ data: { stage: 'asking' } });
          return ctx.build({
            type: 'com_inventory_reserve',
            data: { items: ['book'] },
          });
        },
      })
      .handler('1.1.0', {
        state: z.object({ stage: z.string(), rush: z.boolean() }),
        execute: async () => {},
      })
      .handler('2.0.0', async (ctx) =>
        ctx.build({ type: 'evt_order_shipped', data: { tracking: 't-1' } }),
      )
      .build();

    // the member it needs, and not the one it does not
    const outcome = await handler.execute({
      event: anOrder(),
      state: resolver,
      attempt: 0,
      dependencies: heldDependencies({ needed: 'here' }).dependency,
    });

    expect(outcome.kind).toBe('produced');
    expect(optionalMembers[0]).toBeUndefined();

    // And the other way round: the one it needs is missing. A mechanism
    // that knowingly carries less than a version declared says so here,
    // which is the one place that knows its coverage is partial.
    const refusal = await handler.tryExecute({
      event: anOrder('order-2'),
      state: resolver,
      attempt: 0,
      dependencies: heldDependencies({
        optional: 'here',
      }).dependency as IArvoEventHandlerDependency<{
        needed: string;
        optional?: string;
      }>,
    });

    expect(refusal.ok).toBe(false);
    if (refusal.ok) return;
    expect(refusal.error.message).toContain('needs `needed`');
  });

  it('reads an empty set deliberately exposed as supplied, not as absence', async () => {
    const observations = noObservations();
    const { resolver } = watchedStore(observations);

    await recordingHandler(observations).execute({
      event: anOrder(),
      state: resolver,
      attempt: 0,
      hooks: {},
    });

    // the distinction the empty-object substitution destroyed
    expect(observations.hooks[0]).not.toBeNull();
    expect(observations.hooks[0]).toEqual({});
  });
});
