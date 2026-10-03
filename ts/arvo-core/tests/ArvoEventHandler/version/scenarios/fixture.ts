import { z } from 'zod';
import { ArvoContract } from '../../../../src/ArvoContract/index.js';
import type { ArvoExecutionContext } from '../../../../src/ArvoEventHandler/context/index.js';
import { ARVO_DEFAULT_HANDLER_OPTIONS } from '../../../../src/ArvoEventHandler/helpers/defaults.js';
import type { ArvoExecutorEmission } from '../../../../src/ArvoEventHandler/types/execute.js';
import type { ArvoEventHandlerOptions } from '../../../../src/ArvoEventHandler/types/options.js';
import { ArvoEventHandlerVersion } from '../../../../src/ArvoEventHandler/version/index.js';
import type { PromiseAble } from '../../../../src/types.js';

/**
 * The contracts a hostile lattice is built from.
 *
 * Six, and each earns its place: an orchestrator at two versions, two
 * workers that differ in how they fail, a service that can only be
 * fulfilled off the lattice, one that calls itself, and one that answers
 * nobody.
 */

/** What an orchestrator remembers at its first version. */
export const orderState = z.object({
  stage: z.string(),
  answers: z.number(),
});

/** What it remembers at its second, which the first cannot satisfy. */
export const rushOrderState = z.object({
  stage: z.string(),
  answers: z.number(),
  rush: z.boolean(),
});

/** The orchestrator, at two versions that remember different things. */
export const orderContract = new ArvoContract({
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
  },
});

/** A worker that answers at once. */
export const inventoryContract = new ArvoContract({
  type: 'com_inventory_reserve',
  versions: {
    '1.0.0': {
      input: z.object({ items: z.array(z.string()) }),
      outputs: { evt_inventory_reserved: z.object({ held: z.number() }) },
    },
  },
});

/** A worker that is slow, and can refuse. */
export const paymentContract = new ArvoContract({
  type: 'com_payment_charge',
  versions: {
    '1.0.0': {
      input: z.object({ amount: z.number() }),
      outputs: { evt_payment_charged: z.object({ receipt: z.string() }) },
    },
  },
});

/** Work no handler can do, which leaves the lattice and may come back. */
export const reviewContract = new ArvoContract({
  type: 'com_manual_review',
  domain: 'human_review',
  versions: {
    '1.0.0': {
      input: z.object({ order_id: z.string() }),
      outputs: { evt_review_decided: z.object({ approved: z.boolean() }) },
    },
  },
});

/** A contract that calls itself, for recursion and depth. */
export const walkContract = new ArvoContract({
  type: 'com_tree_walk',
  versions: {
    '1.0.0': {
      input: z.object({ node: z.string(), remaining: z.number() }),
      outputs: { evt_walk_done: z.object({ visited: z.number() }) },
    },
  },
});

/** No outputs and no services: the one shape that completes by returning nothing. */
export const auditContract = new ArvoContract({
  type: 'com_audit_write',
  versions: {
    '1.0.0': { input: z.object({ line: z.string() }), outputs: {} },
  },
});

export const orderV1 = orderContract.versions['1.0.0'];
export const orderV11 = orderContract.versions['1.1.0'];
export const inventoryV1 = inventoryContract.versions['1.0.0'];
export const paymentV1 = paymentContract.versions['1.0.0'];
export const reviewV1 = reviewContract.versions['1.0.0'];
export const walkV1 = walkContract.versions['1.0.0'];
export const auditV1 = auditContract.versions['1.0.0'];

/** What an orchestrator may send to. */
export const orderServices = {
  inventory: inventoryV1,
  payment: paymentV1,
  review: reviewV1,
};

/** What a walker may send to: itself, and nothing else. */
export const walkServices = { deeper: walkV1 };

/** What each kind of execution can know and do. */
export type OrderContext = ArvoExecutionContext<
  typeof orderV1,
  typeof orderServices,
  typeof orderState
>;
export type RushOrderContext = ArvoExecutionContext<
  typeof orderV11,
  typeof orderServices,
  typeof rushOrderState
>;
export type WorkerContext<TSelf extends typeof inventoryV1 | typeof paymentV1> =
  ArvoExecutionContext<TSelf, Record<string, never>, typeof orderState>;
export type WalkContext = ArvoExecutionContext<
  typeof walkV1,
  typeof walkServices,
  typeof orderState
>;
export type AuditContext = ArvoExecutionContext<
  typeof auditV1,
  Record<string, never>,
  typeof orderState
>;

/**
 * What an executor does, supplied per execution rather than declared.
 *
 * A scenario is then a configuration rather than another handler: the same
 * six contracts drive every one, and what makes a scenario cruel is what
 * it tells an executor to do, not a new version written to be cruel.
 */
export type ArvoBehaviour<TContext> = (
  ctx: TContext,
) => PromiseAble<ArvoExecutorEmission>;

/** What a lattice hands an executor, beyond what the protocol hands it. */
export type ArvoScenarioDependencies = {
  /** What this execution should do, where the scenario said. */
  behave?: ArvoBehaviour<never>;
  /** Whatever else a scenario wants an executor to read. */
  [key: string]: unknown;
};

/** Whichever the scenario supplied, or what this version does by default. */
const behaving = <TContext extends { dependencies: ArvoScenarioDependencies }>(
  ctx: TContext,
  byDefault: ArvoBehaviour<TContext>,
): PromiseAble<ArvoExecutorEmission> => {
  const told = ctx.dependencies.behave as ArvoBehaviour<TContext> | undefined;
  return told === undefined ? byDefault(ctx) : told(ctx);
};

/**
 * What an orchestrator does when nobody says otherwise: ask every service
 * it declares, then answer its caller once they have all replied.
 */
const orchestrate = async (
  ctx: OrderContext | RushOrderContext,
): Promise<ArvoExecutorEmission> => {
  if (ctx.entry === 'init') {
    await ctx.setState({
      data: { stage: 'asking', answers: 0, rush: false },
    });
    return [
      await ctx.build({
        type: 'com_inventory_reserve',
        data: { items: ctx.state.initEvent.data.items },
      }),
      await ctx.build({ type: 'com_payment_charge', data: { amount: 100 } }),
    ];
  }

  const answers = [...ctx.state.inFlightEventMap.values()].filter(
    (answer) => answer !== null,
  ).length;
  await ctx.setState({ data: { stage: 'answering', answers, rush: false } });
  return ctx.build({
    type: 'evt_order_fulfilled',
    data: { order_id: ctx.state.subject },
  });
};

/** What a worker does: answer the one thing it was asked. */
const reserve = async (
  ctx: WorkerContext<typeof inventoryV1>,
): Promise<ArvoExecutorEmission> => {
  await ctx.setState({ data: { stage: 'done', answers: 0 } });
  return ctx.build({
    type: 'evt_inventory_reserved',
    data: { held: ctx.state.initEvent.data.items.length },
  });
};

const charge = async (
  ctx: WorkerContext<typeof paymentV1>,
): Promise<ArvoExecutorEmission> => {
  await ctx.setState({ data: { stage: 'done', answers: 0 } });
  return ctx.build({
    type: 'evt_payment_charged',
    data: { receipt: `r-${ctx.state.initEvent.data.amount}` },
  });
};

/** What a walker does: go one level deeper, or answer where it cannot. */
const walk = async (ctx: WalkContext): Promise<ArvoExecutorEmission> => {
  if (ctx.entry === 'followup') {
    await ctx.setState({ data: { stage: 'done', answers: 1 } });
    return ctx.build({ type: 'evt_walk_done', data: { visited: 1 } });
  }

  await ctx.setState({ data: { stage: 'walking', answers: 0 } });
  const remaining = ctx.state.initEvent.data.remaining;
  if (remaining <= 0 || ctx.atMaxDepth) {
    return ctx.build({ type: 'evt_walk_done', data: { visited: 1 } });
  }
  return ctx.build({
    type: 'com_tree_walk',
    data: {
      node: `${ctx.state.initEvent.data.node}/x`,
      remaining: remaining - 1,
    },
  });
};

/** What a sink does: its work, and nothing to say about it. */
const audit = async (ctx: AuditContext): Promise<ArvoExecutorEmission> => {
  await ctx.setState({ data: { stage: 'written', answers: 0 } });
};

/** Options as declared, with whatever this scenario wants to differ. */
export const optionsWith = (
  overrides: Partial<ArvoEventHandlerOptions> = {},
): ArvoEventHandlerOptions => ({
  ...ARVO_DEFAULT_HANDLER_OPTIONS,
  ...overrides,
});

/** Every option a scenario may set, per contract type. */
export type ArvoScenarioOptions = Partial<
  Record<string, Partial<ArvoEventHandlerOptions>>
>;

/**
 * Every version a lattice can run, keyed as a lattice routes: by the
 * contract type an event names, then by the version running it.
 *
 * Built per scenario rather than shared, so one scenario's options and one
 * scenario's executors never reach another.
 */
export type ArvoVersionsUnderTest = Record<
  string,
  // A lattice holds versions of six shapes and routes between them by
  // type; each shape is proven where its executor is written, not here
  // where they are collected.
  Record<string, ArvoEventHandlerVersion<any, any, any, any, any>>
>;

/** Every version, declared fresh, with whatever options a scenario set. */
export const declareVersions = (
  options: ArvoScenarioOptions = {},
): ArvoVersionsUnderTest => {
  const per = (type: string) => optionsWith(options[type]);

  return {
    [orderContract.type]: {
      '1.0.0': new ArvoEventHandlerVersion({
        contracts: { self: orderV1, services: orderServices },
        options: per(orderContract.type),
        state: orderState,
        execute: (ctx) => behaving(ctx, orchestrate),
      }),
      '1.1.0': new ArvoEventHandlerVersion({
        contracts: { self: orderV11, services: orderServices },
        options: per(orderContract.type),
        state: rushOrderState,
        execute: (ctx) => behaving(ctx, orchestrate),
      }),
    },
    [inventoryContract.type]: {
      '1.0.0': new ArvoEventHandlerVersion({
        contracts: { self: inventoryV1, services: {} },
        options: per(inventoryContract.type),
        state: orderState,
        execute: (ctx) => behaving(ctx, reserve),
      }),
    },
    [paymentContract.type]: {
      '1.0.0': new ArvoEventHandlerVersion({
        contracts: { self: paymentV1, services: {} },
        options: per(paymentContract.type),
        state: orderState,
        execute: (ctx) => behaving(ctx, charge),
      }),
    },
    [walkContract.type]: {
      '1.0.0': new ArvoEventHandlerVersion({
        contracts: { self: walkV1, services: walkServices },
        options: per(walkContract.type),
        state: orderState,
        execute: (ctx) => behaving(ctx, walk),
      }),
    },
    [auditContract.type]: {
      '1.0.0': new ArvoEventHandlerVersion({
        contracts: { self: auditV1, services: {} },
        options: per(auditContract.type),
        state: orderState,
        execute: (ctx) => behaving(ctx, audit),
      }),
    },
  };
};
