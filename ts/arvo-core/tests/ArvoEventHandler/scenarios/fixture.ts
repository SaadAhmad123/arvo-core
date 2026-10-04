import { z } from 'zod';
import { ArvoContract } from '../../../src/ArvoContract/index.js';
import type { ArvoExecutionContext } from '../../../src/ArvoEventHandler/context/index.js';
import type { ARVO_NO_STATE_SCHEMA } from '../../../src/ArvoEventHandler/helpers/defaults.js';
import type { ArvoExecutorEmission } from '../../../src/ArvoEventHandler/types/execute.js';
import type { ArvoEventHandlerOptions } from '../../../src/ArvoEventHandler/types/options.js';
import { setupArvoEventHandler } from '../../../src/factories/setupArvoEventHandler.js';
import type { PromiseAble } from '../../../src/types.js';

/**
 * The contracts a handler under test is built from.
 *
 * The orchestrator carries three versions rather than two, and they
 * differ in every way a version can: what they take in, what they answer
 * with, what they remember, and what bounds they run under. A handler
 * routing an execution to the wrong one of two could still look right by
 * accident; with three that differ in all four, it cannot.
 */

/** What the first version remembers. */
export const firstState = z.object({ stage: z.string(), answers: z.number() });

/** What the second remembers, which the first cannot satisfy. */
export const secondState = z.object({
  stage: z.string(),
  answers: z.number(),
  rush: z.boolean(),
});

/** The orchestrator, at three versions that agree on almost nothing. */
export const fulfilContract = new ArvoContract({
  type: 'com_order_fulfil',
  domain: 'orders',
  versions: {
    '1.0.0': {
      input: z.object({ items: z.array(z.string()) }),
      outputs: { evt_order_fulfilled: z.object({ order_id: z.string() }) },
    },
    '1.1.0': {
      input: z.object({ items: z.array(z.string()), rush: z.boolean() }),
      outputs: { evt_order_fulfilled: z.object({ order_id: z.string() }) },
    },
    // answers with something the others never do, and remembers nothing
    '2.0.0': {
      input: z.object({ items: z.array(z.string()) }),
      outputs: { evt_order_shipped: z.object({ tracking: z.string() }) },
    },
  },
});

/** A service that answers at once. */
export const inventoryContract = new ArvoContract({
  type: 'com_inventory_reserve',
  versions: {
    '1.0.0': {
      input: z.object({ items: z.array(z.string()) }),
      outputs: { evt_inventory_reserved: z.object({ held: z.number() }) },
    },
    // declared by nobody: what a participant one upgrade ahead answers at
    '1.1.0': {
      input: z.object({ items: z.array(z.string()) }),
      outputs: { evt_inventory_reserved: z.object({ held: z.number() }) },
    },
  },
});

/** A service that can refuse. */
export const paymentContract = new ArvoContract({
  type: 'com_payment_charge',
  versions: {
    '1.0.0': {
      input: z.object({ amount: z.number() }),
      outputs: { evt_payment_charged: z.object({ receipt: z.string() }) },
    },
  },
});

/** A contract that calls itself, so recursion is reachable through a handler. */
export const walkContract = new ArvoContract({
  type: 'com_tree_walk',
  versions: {
    '1.0.0': {
      input: z.object({ node: z.string(), remaining: z.number() }),
      outputs: { evt_walk_done: z.object({ visited: z.number() }) },
    },
  },
});

/** A contract this handler never declared, for an event from a stranger. */
export const strangerContract = new ArvoContract({
  type: 'com_something_else',
  versions: {
    '1.0.0': {
      input: z.object({ whatever: z.string() }),
      outputs: { evt_something_happened: z.object({ it: z.string() }) },
    },
  },
});

export const fulfilV1 = fulfilContract.versions['1.0.0'];
export const fulfilV11 = fulfilContract.versions['1.1.0'];
export const fulfilV2 = fulfilContract.versions['2.0.0'];
export const inventoryV1 = inventoryContract.versions['1.0.0'];
export const inventoryV11 = inventoryContract.versions['1.1.0'];
export const paymentV1 = paymentContract.versions['1.0.0'];
export const walkV1 = walkContract.versions['1.0.0'];
export const strangerV1 = strangerContract.versions['1.0.0'];

/** What the orchestrator may send to. */
export const fulfilServices = {
  inventory: inventoryV1,
  payment: paymentV1,
};

/** What a walker may send to: itself, and nothing else. */
export const walkServices = { deeper: walkV1 };

/** What each version's executor can know and do. */
export type FirstContext = ArvoExecutionContext<
  typeof fulfilV1,
  typeof fulfilServices,
  typeof firstState,
  ScenarioDependencies
>;
export type SecondContext = ArvoExecutionContext<
  typeof fulfilV11,
  typeof fulfilServices,
  typeof secondState,
  ScenarioDependencies
>;
export type ThirdContext = ArvoExecutionContext<
  typeof fulfilV2,
  typeof fulfilServices,
  typeof ARVO_NO_STATE_SCHEMA,
  ScenarioDependencies
>;
export type WalkContext = ArvoExecutionContext<
  typeof walkV1,
  typeof walkServices,
  typeof firstState,
  ScenarioDependencies
>;

/**
 * What an executor does, supplied per execution rather than declared.
 *
 * A scenario is a configuration rather than another handler: one set of
 * contracts drives every one, and what makes a scenario cruel is what it
 * tells an executor to do.
 */
/**
 * Typed loosely because one behaviour covers three versions whose
 * contexts differ, and each is checked where it is written.
 */
export type ScenarioBehaviour = (
  ctx: FirstContext | SecondContext | ThirdContext | WalkContext,
) => PromiseAble<ArvoExecutorEmission>;

/** What a scenario hands an executor beyond what the protocol hands it. */
export type ScenarioDependencies = {
  /** What this execution should do, where the scenario said. */
  behave?: ScenarioBehaviour;
  /** Whatever else a scenario wants an executor to read. */
  [key: string]: unknown;
};

/** Whichever the scenario supplied, or what this version does by default. */
const behaving = <TContext extends { dependencies: ScenarioDependencies }>(
  ctx: TContext,
  byDefault: (ctx: TContext) => PromiseAble<ArvoExecutorEmission>,
): PromiseAble<ArvoExecutorEmission> => {
  const told = ctx.dependencies.behave;
  return told === undefined
    ? byDefault(ctx)
    : told(ctx as unknown as Parameters<ScenarioBehaviour>[0]);
};

/** How each version behaves when nothing tells it otherwise. */
export const DEFAULT_BEHAVIOURS = {
  /** Asks both services, then answers its caller once both have replied. */
  first: async (ctx: FirstContext): Promise<ArvoExecutorEmission> => {
    if (ctx.entry === 'init') {
      await ctx.setState({ data: { stage: 'asking', answers: 0 } });
      return [
        await ctx.build({
          type: 'com_inventory_reserve',
          data: { items: ['book'] },
        }),
        await ctx.build({ type: 'com_payment_charge', data: { amount: 10 } }),
      ];
    }
    await ctx.setState({ data: { stage: 'answering', answers: 2 } });
    return ctx.build({
      type: 'evt_order_fulfilled',
      data: { order_id: ctx.state.subject },
    });
  },

  /** The same, remembering one thing more. */
  second: async (ctx: SecondContext): Promise<ArvoExecutorEmission> => {
    if (ctx.entry === 'init') {
      await ctx.setState({
        data: { stage: 'asking', answers: 0, rush: true },
      });
      return ctx.build({ type: 'com_payment_charge', data: { amount: 20 } });
    }
    await ctx.setState({
      data: { stage: 'answering', answers: 1, rush: true },
    });
    return ctx.build({
      type: 'evt_order_fulfilled',
      data: { order_id: ctx.state.subject },
    });
  },

  /** Remembers nothing, and answers with what only it answers with. */
  third: async (ctx: ThirdContext): Promise<ArvoExecutorEmission> =>
    ctx.build({
      type: 'evt_order_shipped',
      data: { tracking: `t-${ctx.state.subject}` },
    }),
} as const;

/**
 * The same contract after a version has been drained and removed.
 *
 * The same `type`, and therefore the same `uri`, so a record written
 * under the version that has gone still resolves to this contract — and
 * is refused for naming a version nothing declares, which is what a
 * rolling upgrade actually looks like from the inside.
 */
export const fulfilContractAfterDrain = new ArvoContract({
  type: 'com_order_fulfil',
  domain: 'orders',
  versions: {
    '1.1.0': {
      input: z.object({ items: z.array(z.string()), rush: z.boolean() }),
      outputs: { evt_order_fulfilled: z.object({ order_id: z.string() }) },
    },
    '2.0.0': {
      input: z.object({ items: z.array(z.string()) }),
      outputs: { evt_order_shipped: z.object({ tracking: z.string() }) },
    },
  },
});

/** What a scenario changes about how the handler under test is declared. */
export type ScenarioShape = {
  /** Options the handler holds, which each version falls back to. */
  options?: Partial<ArvoEventHandlerOptions>;
  /** Options one version declares for itself. */
  versionOptions?: Partial<
    Record<'1.0.0' | '1.1.0' | '2.0.0', Partial<ArvoEventHandlerOptions>>
  >;
};

/** The handler under test, declared as a scenario asks for it. */
export const declareHandler = (shape: ScenarioShape = {}) =>
  setupArvoEventHandler({
    contracts: { self: fulfilContract, services: fulfilServices },
    ...(shape.options === undefined ? {} : { options: shape.options }),
    types: {} as { dependencies: ScenarioDependencies },
  })
    .handler('1.0.0', {
      state: firstState,
      ...(shape.versionOptions?.['1.0.0'] === undefined
        ? {}
        : { options: shape.versionOptions['1.0.0'] }),
      execute: (ctx) => behaving(ctx, DEFAULT_BEHAVIOURS.first),
    })
    .handler('1.1.0', {
      state: secondState,
      ...(shape.versionOptions?.['1.1.0'] === undefined
        ? {}
        : { options: shape.versionOptions['1.1.0'] }),
      execute: (ctx) => behaving(ctx, DEFAULT_BEHAVIOURS.second),
    })
    .handler('2.0.0', {
      ...(shape.versionOptions?.['2.0.0'] === undefined
        ? {}
        : { options: shape.versionOptions['2.0.0'] }),
      execute: (ctx) => behaving(ctx, DEFAULT_BEHAVIOURS.third),
    })
    .build();

/** The same handler once its first version has been drained away. */
export const declareHandlerAfterDrain = () =>
  setupArvoEventHandler({
    contracts: { self: fulfilContractAfterDrain, services: fulfilServices },
    types: {} as { dependencies: ScenarioDependencies },
  })
    .handler('1.1.0', {
      state: secondState,
      execute: (ctx) => behaving(ctx, DEFAULT_BEHAVIOURS.second),
    })
    .handler('2.0.0', {
      execute: (ctx) => behaving(ctx, DEFAULT_BEHAVIOURS.third),
    })
    .build();

/** A handler that calls itself, for recursion through the gate. */
export const declareWalker = () =>
  setupArvoEventHandler({
    contracts: { self: walkContract, services: walkServices },
    types: {} as { dependencies: ScenarioDependencies },
  })
    .handler('1.0.0', {
      state: firstState,
      execute: (ctx: WalkContext) =>
        behaving(ctx, async (walking: WalkContext) => {
          if (walking.entry === 'followup') {
            await walking.setState({ data: { stage: 'done', answers: 1 } });
            return walking.build({
              type: 'evt_walk_done',
              data: { visited: 1 },
            });
          }
          const remaining =
            walking.state.initEvent.type === 'com_tree_walk'
              ? (walking.state.initEvent.data as { remaining: number })
                  .remaining
              : 0;
          await walking.setState({ data: { stage: 'walking', answers: 0 } });
          if (remaining <= 0) {
            return walking.build({
              type: 'evt_walk_done',
              data: { visited: 1 },
            });
          }
          return walking.build({
            type: 'com_tree_walk',
            data: { node: `${remaining - 1}`, remaining: remaining - 1 },
          });
        }),
    })
    .build();
