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
type Seen = {
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

const watching = (): Seen => ({
  dependencies: [],
  hooks: [],
  resolverCalls: [],
  factoryCalls: [],
});

/** A handler whose executor records everything it was handed. */
const handlerRecording = (seen: Seen) =>
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
        seen.dependencies.push(ctx.dependencies);
        seen.hooks.push(ctx.hooks);
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
      seen.dependencies.push(ctx.dependencies);
      seen.hooks.push(ctx.hooks);
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
const storeWatching = (seen: Seen) => {
  const store = new ScenarioStore();
  return {
    store,
    resolver: (param: {
      executionId: string;
      attempt: number;
      telemetry: unknown;
    }) => {
      seen.resolverCalls.push({
        executionId: param.executionId,
        attempt: param.attempt,
        hadTelemetry: param.telemetry !== undefined,
      });
      return store.rows.get(param.executionId) ?? null;
    },
  };
};

const answering = (
  opened: { state: JSONObject; events: readonly { id: string }[] },
  subject = 'order-1',
) =>
  createArvoEventFactory(inventoryV1).createOutput({
    type: 'evt_inventory_reserved',
    source: inventoryV1.type,
    subject,
    to: fulfilContract.type,
    executionid: String(opened.state.executionId),
    initid: opened.events[0]?.id,
    parentid: opened.events[0]?.id,
    data: { held: 1 },
  });

describe('the way a handler reaches a store', () => {
  it('is asked once per execution, under one identifier', async () => {
    const seen = watching();
    const { store, resolver } = storeWatching(seen);
    const handler = handlerRecording(seen);

    const opened = await handler.execute({
      event: anOrder(),
      state: resolver,
      attempt: 0,
    });
    if (opened.kind !== 'produced') throw new Error('nothing was opened');

    expect(seen.resolverCalls).toHaveLength(1);
    expect(seen.resolverCalls[0]?.executionId).toBe(
      String(opened.state.executionId),
    );
    store.commit(opened.state);
  });

  it('is told which attempt it is, so it may read differently on a retry', async () => {
    const seen = watching();
    const { resolver } = storeWatching(seen);
    await handlerRecording(seen).execute({
      event: anOrder(),
      state: resolver,
      attempt: 3,
    });
    expect(seen.resolverCalls[0]?.attempt).toBe(3);
  });

  it('is given somewhere to record, so the read is part of the execution', async () => {
    const seen = watching();
    const { resolver } = storeWatching(seen);
    await handlerRecording(seen).execute({
      event: anOrder(),
      state: resolver,
      attempt: 0,
    });
    expect(seen.resolverCalls[0]?.hadTelemetry).toBe(true);
  });

  it('is asked again on the next execution, never answered from before', async () => {
    const seen = watching();
    const { store, resolver } = storeWatching(seen);
    const handler = handlerRecording(seen);

    const opened = await handler.execute({
      event: anOrder(),
      state: resolver,
      attempt: 0,
    });
    if (opened.kind !== 'produced') throw new Error('nothing was opened');
    store.commit(opened.state);

    await handler.execute({
      event: answering(opened),
      state: resolver,
      attempt: 0,
    });
    expect(seen.resolverCalls).toHaveLength(2);
  });

  it('refuses a row that is not an object at all', async () => {
    const handler = handlerRecording(watching());
    for (const notARow of ['a string', 7, true, []]) {
      const refused = await handler.tryExecute({
        event: anOrder(),
        state: () => notARow as unknown as JSONObject,
        attempt: 0,
      });
      expect(
        !refused.ok && refused.error.faultKind,
        `${JSON.stringify(notARow)} was not refused`,
      ).toBe('record_unexpected');
    }
  });
});

describe('what an executor is given to work with', () => {
  it('is absence where nothing was supplied, and says so', async () => {
    const seen = watching();
    const { resolver } = storeWatching(seen);
    await handlerRecording(seen).execute({
      event: anOrder(),
      state: resolver,
      attempt: 0,
    });
    // not an empty object standing in for one: a version that declared
    // something and was given none must be able to tell
    expect(seen.dependencies[0]).toBeNull();
  });

  it('is what the dependency exposes, and not the dependency', async () => {
    const seen = watching();
    const { resolver } = storeWatching(seen);
    const given = { note: 'given' } as unknown as ScenarioDependencies;
    const { dependency } = heldDependencies(given);

    await handlerRecording(seen).execute({
      event: anOrder(),
      state: resolver,
      attempt: 0,
      dependencies: dependency,
    });

    // what it exposes, so an executor cannot reach the lifetime
    expect(seen.dependencies[0]).toBe(given);
    expect(seen.dependencies[0]).not.toBe(dependency);
    expect(seen.dependencies[0]).not.toHaveProperty('open');
    expect(seen.dependencies[0]).not.toHaveProperty('close');
  });

  it('is opened exactly once for one execution, before the executor', async () => {
    const seen = watching();
    const { resolver } = storeWatching(seen);
    const { dependency, calls } = openedPerExecution(
      () => ({ note: 'built' }) as unknown as ScenarioDependencies,
    );

    await handlerRecording(seen).execute({
      event: anOrder(),
      state: resolver,
      attempt: 0,
      dependencies: dependency,
    });

    expect(calls.opened.length).toBe(1);
    // the executor read it, so it was open by the time it ran
    expect(seen.dependencies[0]).toEqual({ note: 'built' });
  });

  it('is closed exactly once, after the execution has produced its record', async () => {
    const seen = watching();
    const { resolver } = storeWatching(seen);
    const { dependency, calls } = openedPerExecution(
      () => ({ note: 'built' }) as unknown as ScenarioDependencies,
    );

    const produced = await handlerRecording(seen).execute({
      event: anOrder(),
      state: resolver,
      attempt: 0,
      dependencies: dependency,
    });

    expect(produced.kind).toBe('produced');
    expect(calls.closed.length).toBe(1);
  });

  it('costs the execution nothing where it cannot be let go of', async () => {
    // Closing happens after the work is done and the record is built,
    // so a failure to close has nothing left to spoil. It is recorded
    // on the span and goes no further — the caller is told what the
    // execution produced, not that a connection would not go back.
    const seen = watching();
    const { resolver } = storeWatching(seen);
    const { dependency, calls } = failingToClose(
      { note: 'built' } as unknown as ScenarioDependencies,
      new Error('the pool had already gone'),
    );

    const produced = await handlerRecording(seen).tryExecute({
      event: anOrder(),
      state: resolver,
      attempt: 0,
      dependencies: dependency,
    });

    expect(produced.ok && produced.value.kind).toBe('produced');
    expect(calls.closed.length).toBe(1);
  });

  it('is opened again for the next execution, never kept from the last', async () => {
    const seen = watching();
    const { store, resolver } = storeWatching(seen);
    const handler = handlerRecording(seen);
    let built = 0;

    const { dependency } = openedPerExecution(() => {
      built += 1;
      return { note: `built-${built}` } as unknown as ScenarioDependencies;
    });

    const opened = await handler.execute({
      event: anOrder(),
      state: resolver,
      attempt: 0,
      dependencies: dependency,
    });
    if (opened.kind !== 'produced') throw new Error('nothing was opened');
    store.commit(opened.state);

    await handler.execute({
      event: answering(opened),
      state: resolver,
      attempt: 0,
      dependencies: dependency,
    });

    // the same object twice, and a different thing held each time —
    // which is why a supplier may keep the object and must not keep
    // what it holds
    expect(built).toBe(2);
    expect(seen.dependencies[0]).not.toBe(seen.dependencies[1]);
  });

  it('is told what caused this execution, and which attempt it is', async () => {
    const seen = watching();
    const { resolver } = storeWatching(seen);
    const order = anOrder();
    const { dependency, calls } = openedPerExecution(
      () => ({}) as unknown as ScenarioDependencies,
    );

    await handlerRecording(seen).execute({
      event: order,
      state: resolver,
      attempt: 2,
      dependencies: dependency,
    });

    expect(calls.opened[0]?.event.id).toBe(order.id);
    expect(calls.opened[0]?.attempt).toBe(2);
  });

  it('is told the execution it is for, and where that execution records', async () => {
    const seen = watching();
    const { resolver } = storeWatching(seen);
    const { dependency, calls } = openedPerExecution(
      () => ({}) as unknown as ScenarioDependencies,
    );

    const produced = await handlerRecording(seen).execute({
      event: anOrder(),
      state: resolver,
      attempt: 0,
      dependencies: dependency,
    });
    if (produced.kind !== 'produced') throw new Error('nothing was produced');

    expect(calls.opened[0]?.executionId).toBe(produced.state.executionId);
    expect(calls.opened[0]?.telemetry).toBeDefined();
    // closed for the same execution it was opened for
    expect(calls.closed[0]?.executionId).toBe(produced.state.executionId);
  });

  it('sees absence where the execution had no record yet, and the record where it did', async () => {
    const seen = watching();
    const { store, resolver } = storeWatching(seen);
    const handler = handlerRecording(seen);
    const { dependency, calls } = openedPerExecution(
      () => ({}) as unknown as ScenarioDependencies,
    );

    const opened = await handler.execute({
      event: anOrder(),
      state: resolver,
      attempt: 0,
      dependencies: dependency,
    });
    if (opened.kind !== 'produced') throw new Error('nothing was opened');
    store.commit(opened.state);

    await handler.execute({
      event: answering(opened),
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
    const seen = watching();
    const { resolver } = storeWatching(seen);
    await handlerRecording(seen).execute({
      event: anOrder(),
      state: resolver,
      attempt: 0,
    });
    expect(seen.hooks[0]).toBeNull();
  });

  it('is passed through exactly as it was given, uninterpreted', async () => {
    const seen = watching();
    const { resolver } = storeWatching(seen);
    const exposed = { scheduler: { at: 1 }, whatever: Symbol('opaque') };

    await handlerRecording(seen).execute({
      event: anOrder(),
      state: resolver,
      attempt: 0,
      hooks: exposed,
    });
    expect(seen.hooks[0]).toBe(exposed);
  });

  it('is passed through even where it is not an object at all', async () => {
    const seen = watching();
    const { resolver } = storeWatching(seen);
    await handlerRecording(seen).execute({
      event: anOrder(),
      state: resolver,
      attempt: 0,
      hooks: 'whatever this mechanism means' as never,
    });
    expect(seen.hooks[0]).toBe('whatever this mechanism means');
  });

  it('never reaches the record either', async () => {
    const seen = watching();
    const { resolver } = storeWatching(seen);
    const ran = await handlerRecording(seen).execute({
      event: anOrder(),
      state: resolver,
      attempt: 0,
      hooks: { secret: 'nothing may store this' },
    });
    if (ran.kind !== 'produced') throw new Error('nothing was opened');
    expect(JSON.stringify(ran.state)).not.toContain('nothing may store this');
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

    const brittle = {} as { brittle: string };
    Object.defineProperty(brittle, 'brittle', {
      get() {
        throw new Error('this hook cannot be read');
      },
    });

    // the work failed, which is a conclusion rather than a fault
    const ran = await handler.execute({
      event: anOrder(),
      state: new ScenarioStore().resolver,
      attempt: 0,
      hooks: brittle,
    });
    expect(ran.kind).toBe('produced');
    expect(ran.kind === 'produced' && ran.state.lifecycle).toBe('error');
    expect(ran.kind === 'produced' && ran.events[0]?.type).toBe(
      fulfilV1.error.type,
    );
  });
});

describe('what one execution cannot leave behind for the next', () => {
  it('holds nothing of what it was supplied, across three executions', async () => {
    const seen = watching();
    const { store, resolver } = storeWatching(seen);
    const handler = handlerRecording(seen);

    for (const subject of ['order-a', 'order-b', 'order-c']) {
      const ran = await handler.execute({
        event: anOrder(subject),
        state: resolver,
        attempt: 0,
        dependencies: heldDependencies({
          note: subject,
        } as unknown as ScenarioDependencies).dependency,
        hooks: { ticket: subject },
      });
      if (ran.kind === 'produced') store.commit(ran.state);
    }

    expect(seen.dependencies).toEqual([
      { note: 'order-a' },
      { note: 'order-b' },
      { note: 'order-c' },
    ]);
    expect(seen.hooks).toEqual([
      { ticket: 'order-a' },
      { ticket: 'order-b' },
      { ticket: 'order-c' },
    ]);
  });

  it('holds nothing of either on the handler itself', async () => {
    const seen = watching();
    const { resolver } = storeWatching(seen);
    const handler = handlerRecording(seen);

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
  const handlerNeeding = () =>
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
  const handlerDegrading = (seen: { had: (boolean | null)[] }) =>
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
          seen.had.push(ctx.dependencies !== null);
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
    const seen = { had: [] as (boolean | null)[] };
    const { resolver } = storeWatching(watching());

    const ran = await handlerDegrading(seen).execute({
      event: anOrder(),
      state: resolver,
      attempt: 0,
    });

    // entered, not refused: the protocol does not decide this
    expect(ran.kind).toBe('produced');
    expect(seen.had[0]).toBe(false);
  });

  it('lets an executor that cannot proceed fail, naming what was missing', async () => {
    const { resolver } = storeWatching(watching());

    const refused = await handlerNeeding().tryExecute({
      event: anOrder(),
      state: resolver,
      attempt: 0,
    });

    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error.faultKind).toBe('executor_raised');
    expect(refused.error.message).toContain('needs a catalogue');
    // its own choice, so no further attempt is in prospect
    expect(refused.error.retry).toBeNull();
  });

  it('lets an executor that can proceed carry on', async () => {
    const seen = { had: [] as (boolean | null)[] };
    const { resolver } = storeWatching(watching());
    const given = heldDependencies({} as ScenarioDependencies).dependency;

    const ran = await handlerDegrading(seen).execute({
      event: anOrder(),
      state: resolver,
      attempt: 0,
      dependencies: given,
    });

    expect(ran.kind).toBe('produced');
    expect(seen.had[0]).toBe(true);
  });

  it('reads absence where the mechanism exposed nothing', async () => {
    const seen = watching();
    const { resolver } = storeWatching(seen);

    await handlerRecording(seen).execute({
      event: anOrder(),
      state: resolver,
      attempt: 0,
    });

    expect(seen.hooks[0]).toBeNull();
  });

  it('reads a declared member that was not supplied as absent', async () => {
    /**
     * A mechanism hands what it has to whichever handler an event names,
     * so part of a declaration arriving is the ordinary case rather than
     * an edge. A member that did not arrive is absent for the same
     * reason the whole thing can be.
     */
    const seen = { had: [] as (boolean | null)[] };
    const { resolver } = storeWatching(watching());

    const partial = heldDependencies({
      behave: undefined,
    } as ScenarioDependencies).dependency;

    const ran = await handlerDegrading(seen).execute({
      event: anOrder(),
      state: resolver,
      attempt: 0,
      dependencies: partial,
    });

    // the object arrived, so this is not the null case
    expect(ran.kind).toBe('produced');
    expect(seen.had[0]).toBe(true);
  });

  it('lets an executor decide per member, not once for the whole', async () => {
    const asked: (string | undefined)[] = [];
    const { resolver } = storeWatching(watching());

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
          asked.push(ctx.dependencies.optional);
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
    const ran = await handler.execute({
      event: anOrder(),
      state: resolver,
      attempt: 0,
      dependencies: heldDependencies({ needed: 'here' }).dependency,
    });

    expect(ran.kind).toBe('produced');
    expect(asked[0]).toBeUndefined();

    // And the other way round: the one it needs is missing. A mechanism
    // that knowingly carries less than a version declared says so here,
    // which is the one place that knows its coverage is partial.
    const refused = await handler.tryExecute({
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

    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error.message).toContain('needs `needed`');
  });

  it('reads an empty set deliberately exposed as supplied, not as absence', async () => {
    const seen = watching();
    const { resolver } = storeWatching(seen);

    await handlerRecording(seen).execute({
      event: anOrder(),
      state: resolver,
      attempt: 0,
      hooks: {},
    });

    // the distinction the empty-object substitution destroyed
    expect(seen.hooks[0]).not.toBeNull();
    expect(seen.hooks[0]).toEqual({});
  });
});
