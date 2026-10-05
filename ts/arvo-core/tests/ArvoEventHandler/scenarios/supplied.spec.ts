import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createArvoEventFactory } from '../../../src/factories/ArvoEventFactory/index.js';
import { setupArvoEventHandler } from '../../../src/factories/setupArvoEventHandler.js';
import type { JSONObject } from '../../../src/types.js';
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
  it('is an empty object where nothing was supplied, never absent', async () => {
    const seen = watching();
    const { resolver } = storeWatching(seen);
    await handlerRecording(seen).execute({
      event: anOrder(),
      state: resolver,
      attempt: 0,
    });
    expect(seen.dependencies[0]).toEqual({});
    expect(seen.dependencies[0]).not.toBeUndefined();
  });

  it('is a value used exactly as it stands', async () => {
    const seen = watching();
    const { resolver } = storeWatching(seen);
    const given = { note: 'given' };
    await handlerRecording(seen).execute({
      event: anOrder(),
      state: resolver,
      attempt: 0,
      dependencies: given,
    });
    expect(seen.dependencies[0]).toBe(given);
  });

  it('is built exactly once for one execution', async () => {
    const seen = watching();
    const { resolver } = storeWatching(seen);
    let built = 0;

    await handlerRecording(seen).execute({
      event: anOrder(),
      state: resolver,
      attempt: 0,
      dependencies: () => {
        built += 1;
        return { note: 'built' };
      },
    });
    expect(built).toBe(1);
  });

  it('is built again for the next execution, never kept from the last', async () => {
    const seen = watching();
    const { store, resolver } = storeWatching(seen);
    const handler = handlerRecording(seen);
    let built = 0;

    const factory = () => {
      built += 1;
      return { note: `built-${built}` };
    };

    const opened = await handler.execute({
      event: anOrder(),
      state: resolver,
      attempt: 0,
      dependencies: factory,
    });
    if (opened.kind !== 'produced') throw new Error('nothing was opened');
    store.commit(opened.state);

    await handler.execute({
      event: answering(opened),
      state: resolver,
      attempt: 0,
      dependencies: factory,
    });

    expect(built).toBe(2);
    expect(seen.dependencies[0]).not.toBe(seen.dependencies[1]);
  });

  it('is told what caused this execution, and which attempt it is', async () => {
    const seen = watching();
    const { resolver } = storeWatching(seen);
    const order = anOrder();

    await handlerRecording(seen).execute({
      event: order,
      state: resolver,
      attempt: 2,
      dependencies: (param) => {
        seen.factoryCalls.push({
          event: param.event.id,
          state: param.state,
          executionId: param.executionId,
          attempt: param.attempt,
        });
        return {};
      },
    });

    expect(seen.factoryCalls[0]?.event).toBe(order.id);
    expect(seen.factoryCalls[0]?.attempt).toBe(2);
  });

  it('is given the record where one was read', async () => {
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
      dependencies: (param) => {
        seen.factoryCalls.push({
          event: param.event.id,
          state: param.state,
          executionId: param.executionId,
          attempt: param.attempt,
        });
        return {};
      },
    });

    const given = seen.factoryCalls[0]?.state as { executionId: string } | null;
    expect(given).not.toBeNull();
    expect(given?.executionId).toBe(String(opened.state.executionId));
  });

  it('is given nothing where no record was read', async () => {
    const seen = watching();
    const { resolver } = storeWatching(seen);

    // an event opening an execution has no record to read, so there is
    // nothing of one to hand a factory
    await handlerRecording(seen).execute({
      event: anOrder(),
      state: resolver,
      attempt: 0,
      dependencies: (param) => {
        seen.factoryCalls.push({
          event: param.event.id,
          state: param.state,
          executionId: param.executionId,
          attempt: param.attempt,
        });
        return {};
      },
    });

    expect(seen.factoryCalls[0]?.state).toBeNull();
  });

  it('is told the execution anyway, so one can be keyed on it either way', async () => {
    const seen = watching();
    const { store, resolver } = storeWatching(seen);
    const handler = handlerRecording(seen);
    const record = (param: {
      event: { id: string };
      state: unknown;
      executionId: string;
      attempt: number;
    }) => {
      seen.factoryCalls.push({
        event: param.event.id,
        state: param.state,
        executionId: param.executionId,
        attempt: param.attempt,
      });
      return {};
    };

    const opened = await handler.execute({
      event: anOrder(),
      state: resolver,
      attempt: 0,
      dependencies: record,
    });
    if (opened.kind !== 'produced') throw new Error('nothing was opened');
    store.commit(opened.state);

    await handler.execute({
      event: answering(opened),
      state: resolver,
      attempt: 0,
      dependencies: record,
    });

    // the same execution, named on the one that opened it and on the one
    // that resumed it, though only the second had a record to read
    const named = seen.factoryCalls.map((one) => one.executionId);
    expect(named).toEqual([
      String(opened.state.executionId),
      String(opened.state.executionId),
    ]);
    expect(seen.factoryCalls[0]?.state).toBeNull();
    expect(seen.factoryCalls[1]?.state).not.toBeNull();
  });

  it('is placed unchanged, whatever it turns out to be', async () => {
    const seen = watching();
    const { resolver } = storeWatching(seen);

    // the handler does not inspect what a factory yields
    for (const yielded of [null, 7, 'a string', []]) {
      await handlerRecording(seen).execute({
        event: anOrder(),
        state: resolver,
        attempt: 0,
        dependencies: (() => yielded) as never,
      });
    }
    expect(seen.dependencies.slice(-4)).toEqual([null, 7, 'a string', []]);
  });

  it('never reaches the record, which is JSON and it is not', async () => {
    const seen = watching();
    const { resolver } = storeWatching(seen);

    const ran = await handlerRecording(seen).execute({
      event: anOrder(),
      state: resolver,
      attempt: 0,
      dependencies: { live: () => 'a client nothing can store' },
    });

    if (ran.kind !== 'produced') throw new Error('nothing was opened');
    expect(JSON.stringify(ran.state)).not.toContain('live');
    expect(ran.state.data).toEqual({ stage: 'asking' });
  });

  it('ends the execution where it cannot be built, and is worth another attempt', async () => {
    const refused = await handlerRecording(watching()).tryExecute({
      event: anOrder(),
      state: new ScenarioStore().resolver,
      attempt: 0,
      dependencies: () => {
        throw new Error('the pool is exhausted');
      },
    });
    expect(!refused.ok && refused.error.faultKind).toBe(
      'dependency_resolution_failed',
    );
    expect(!refused.ok && refused.error.retry).not.toBeNull();
  });

  it('stops being worth another attempt once they are spent', async () => {
    const refused = await handlerRecording(watching()).tryExecute({
      event: anOrder(),
      state: new ScenarioStore().resolver,
      attempt: 3,
      dependencies: () => {
        throw new Error('the pool is exhausted');
      },
    });
    expect(!refused.ok && refused.error.retry).toBeNull();
    expect(!refused.ok && refused.error.abandonmentEvent).not.toBeNull();
  });

  it('is never entered where it could not be built', async () => {
    const seen = watching();
    await handlerRecording(seen).tryExecute({
      event: anOrder(),
      state: new ScenarioStore().resolver,
      attempt: 0,
      dependencies: () => {
        throw new Error('the pool is exhausted');
      },
    });
    expect(seen.dependencies).toEqual([]);
  });
});

describe('whatever the mechanism exposes to an executor', () => {
  it('is an empty object where nothing was supplied, never absent', async () => {
    const seen = watching();
    const { resolver } = storeWatching(seen);
    await handlerRecording(seen).execute({
      event: anOrder(),
      state: resolver,
      attempt: 0,
    });
    expect(seen.hooks[0]).toEqual({});
    expect(seen.hooks[0]).not.toBeUndefined();
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
            data: { order_id: ctx.hooks.brittle },
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
        dependencies: { note: subject },
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
      dependencies: { note: 'given' },
      hooks: { ticket: 'T-1' },
    });

    expect(JSON.stringify(handler.contracts)).not.toContain('given');
    expect(Object.keys(handler)).not.toContain('dependencies');
    expect(Object.keys(handler)).not.toContain('hooks');
  });
});
