import { describe, expect, it } from 'vitest';
import type { ArvoEventHandlerMiddlewareEntry } from '../../../src/ArvoEventHandler/types/middleware.js';
import {
  answeringExecutor,
  executeOrder,
  orderHandler,
  orderRequest,
  sleep,
} from './fixture.js';

/**
 * Seeded chaos through the public surface.
 *
 * Every scenario builds a random stack of layers, supplied and declared,
 * static and made per execution, each doing something random in either
 * part, around a random executor. What the execution must come to is
 * predicted from the protocol's rules alone, then several executions of
 * the scenario run at once and each is checked against the prediction. A
 * failing scenario names its seed, so it can be run again exactly.
 */

/** A small seeded generator, so a scenario is the same every run. */
const createRandom = (seed: number) => {
  let generatorState = seed >>> 0;
  const nextFraction = () => {
    generatorState = (generatorState + 0x6d2b79f5) >>> 0;
    let mixed = generatorState;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
  return {
    pick: <TChoice>(choices: readonly TChoice[]): TChoice =>
      choices[Math.floor(nextFraction() * choices.length)] as TChoice,
    integerBelow: (limit: number) => Math.floor(nextFraction() * limit),
  };
};

const BEFORE_BEHAVIOURS = [
  'none',
  'pass',
  'wait',
  'write_state',
  'write_own_key',
  'write_shared_key',
  'throw_error',
  'throw_fault',
  'throw_unprintable',
] as const;
const AFTER_BEHAVIOURS = [
  'none',
  'pass',
  'wait',
  'write_state',
  'throw_error',
  'throw_fault',
  'throw_unprintable',
] as const;
const EXECUTOR_BEHAVIOURS = [
  'answer',
  'throw_error',
  'throw_unprintable',
] as const;

type BeforeBehaviour = (typeof BEFORE_BEHAVIOURS)[number];
type AfterBehaviour = (typeof AFTER_BEHAVIOURS)[number];

type LayerPlan = {
  layerId: string;
  source: 'supplied' | 'declared';
  madePerExecution: boolean;
  beforeBehaviour: BeforeBehaviour;
  afterBehaviour: AfterBehaviour;
};

type Scenario = {
  layerPlans: LayerPlan[];
  executorBehaviour: (typeof EXECUTOR_BEHAVIOURS)[number];
};

/** What an execution of a scenario must come to. */
type Prediction =
  | { outcome: 'answered' }
  | { outcome: 'handler_error' }
  | { outcome: 'fault'; faultKind: string };

const planScenario = (seed: number): Scenario => {
  const random = createRandom(seed);
  const layerCount = random.integerBelow(7);
  const layerPlans = Array.from({ length: layerCount }, (_, layerIndex) => ({
    layerId: `layer_${layerIndex}`,
    source: random.pick(['supplied', 'declared'] as const),
    madePerExecution: random.pick([true, false]),
    beforeBehaviour: random.pick(BEFORE_BEHAVIOURS),
    afterBehaviour: random.pick(AFTER_BEHAVIOURS),
  }));
  return { layerPlans, executorBehaviour: random.pick(EXECUTOR_BEHAVIOURS) };
};

/** Before parts in run order: every supplied layer, then every declared. */
const inRunOrder = (layerPlans: LayerPlan[]) => [
  ...layerPlans.filter((layerPlan) => layerPlan.source === 'supplied'),
  ...layerPlans.filter((layerPlan) => layerPlan.source === 'declared'),
];

const predict = (scenario: Scenario): Prediction => {
  let sharedKeyWritten = false;
  for (const layerPlan of inRunOrder(scenario.layerPlans)) {
    switch (layerPlan.beforeBehaviour) {
      case 'throw_error':
      case 'throw_unprintable':
        return { outcome: 'handler_error' };
      case 'throw_fault':
        return { outcome: 'fault', faultKind: 'executor_raised' };
      case 'write_shared_key':
        if (sharedKeyWritten) {
          return { outcome: 'fault', faultKind: 'middleware_conflict' };
        }
        sharedKeyWritten = true;
        break;
      default:
        break;
    }
  }
  // what any after part does changes nothing
  return scenario.executorBehaviour === 'answer'
    ? { outcome: 'answered' }
    : { outcome: 'handler_error' };
};

/** A value that cannot be turned into text without throwing. */
const unprintableValue = () => Object.create(null);

const buildLayer = (
  layerPlan: LayerPlan,
  layersMade: { instance: object; subject: string }[],
) => {
  const layer = {
    id: layerPlan.layerId,
    async before(ctx: Parameters<typeof answeringExecutor>[0]) {
      layersMade.push({ instance: layer, subject: ctx.state.subject });
      switch (layerPlan.beforeBehaviour) {
        case 'none':
        case 'pass':
          return;
        case 'wait':
          await sleep(Math.random() * 3);
          return;
        case 'write_state':
          await ctx.setState({
            data: { stage: `before_${layerPlan.layerId}` },
          });
          return;
        case 'write_own_key':
          await ctx.setMiddleware(
            `key_${layerPlan.layerId}`,
            ctx.state.subject,
          );
          return;
        case 'write_shared_key':
          await ctx.setMiddleware('shared', layerPlan.layerId);
          return;
        case 'throw_error':
          throw new Error(`${layerPlan.layerId} refused`);
        case 'throw_fault':
          throw await ctx.fault({
            faultKind: 'executor_raised',
            message: `${layerPlan.layerId} faulted`,
            retryable: false,
          });
        case 'throw_unprintable':
          throw unprintableValue();
      }
    },
    async after(ctx: Parameters<typeof answeringExecutor>[0]) {
      switch (layerPlan.afterBehaviour) {
        case 'none':
        case 'pass':
          return;
        case 'wait':
          await sleep(Math.random() * 3);
          return;
        case 'write_state':
          await ctx.setState({ data: { stage: `after_${layerPlan.layerId}` } });
          return;
        case 'throw_error':
          throw new Error(`${layerPlan.layerId} broke afterwards`);
        case 'throw_fault':
          throw await ctx.fault({
            faultKind: 'executor_raised',
            message: `${layerPlan.layerId} faulted afterwards`,
          });
        case 'throw_unprintable':
          throw unprintableValue();
      }
    },
  };
  // a layer without a part must not have one at all
  return {
    id: layer.id,
    ...(layerPlan.beforeBehaviour === 'none'
      ? {}
      : {
          before: (ctx: Parameters<typeof answeringExecutor>[0]) =>
            layer.before(ctx),
        }),
    ...(layerPlan.afterBehaviour === 'none'
      ? {}
      : {
          after: (ctx: Parameters<typeof answeringExecutor>[0]) =>
            layer.after(ctx),
        }),
  };
};

const entryFor = (
  layerPlan: LayerPlan,
  layersMade: { instance: object; subject: string }[],
) =>
  layerPlan.madePerExecution
    ? () => buildLayer(layerPlan, layersMade)
    : buildLayer(layerPlan, layersMade);

const SCENARIO_SEEDS = Array.from(
  { length: 250 },
  (_, seedIndex) => seedIndex + 1,
);
const EXECUTIONS_AT_ONCE = 4;

describe('seeded chaos', () => {
  it.each(SCENARIO_SEEDS)(
    'scenario with seed %i comes to what the protocol says',
    async (seed) => {
      const scenario = planScenario(seed);
      const prediction = predict(scenario);
      const layersMade: { instance: object; subject: string }[] = [];
      const entriesFrom = (source: LayerPlan['source']) =>
        scenario.layerPlans
          .filter((layerPlan) => layerPlan.source === source)
          .map((layerPlan) =>
            entryFor(layerPlan, layersMade),
          ) as ArvoEventHandlerMiddlewareEntry[];

      const handler = orderHandler({
        middleware: entriesFrom('declared'),
        execute: async (ctx) => {
          await sleep(Math.random() * 2);
          if (scenario.executorBehaviour === 'throw_error') {
            throw new Error('the executor failed');
          }
          if (scenario.executorBehaviour === 'throw_unprintable') {
            throw unprintableValue();
          }
          return answeringExecutor(ctx);
        },
      });

      const executionResults = await Promise.all(
        Array.from({ length: EXECUTIONS_AT_ONCE }, (_, executionIndex) =>
          executeOrder(handler, {
            event: orderRequest(`chaos-${seed}-${executionIndex}`),
            middleware: entriesFrom('supplied'),
          }),
        ),
      );

      for (const executionResult of executionResults) {
        if (prediction.outcome === 'fault') {
          expect(executionResult.ok, `seed ${seed}`).toBe(false);
          expect(
            !executionResult.ok && executionResult.error.faultKind,
            `seed ${seed}`,
          ).toBe(prediction.faultKind);
          continue;
        }
        expect(executionResult.ok, `seed ${seed}`).toBe(true);
        if (!executionResult.ok || executionResult.value.kind !== 'produced') {
          throw new Error(`seed ${seed}: nothing was produced`);
        }
        const { state: record, events: emittedEvents } = executionResult.value;
        if (prediction.outcome === 'answered') {
          expect(record.lifecycle, `seed ${seed}`).toBe('success');
          // nothing an after part wrote reached the record
          expect(record.data, `seed ${seed}`).toEqual({ stage: 'answered' });
          expect(
            emittedEvents.map((emittedEvent) => emittedEvent.type),
            `seed ${seed}`,
          ).toEqual(['com_order_created']);
        } else {
          expect(record.lifecycle, `seed ${seed}`).toBe('error');
          expect(emittedEvents, `seed ${seed}`).toHaveLength(1);
        }
      }

      // a layer made per execution served exactly one
      const subjectsByInstance = new Map<object, Set<string>>();
      for (const { instance, subject } of layersMade) {
        subjectsByInstance.set(
          instance,
          (subjectsByInstance.get(instance) ?? new Set()).add(subject),
        );
      }
      const madeIds = new Set(
        scenario.layerPlans
          .filter((layerPlan) => layerPlan.madePerExecution)
          .map((layerPlan) => layerPlan.layerId),
      );
      for (const [instance, subjects] of subjectsByInstance) {
        const instanceId = (instance as { id: string }).id;
        if (madeIds.has(instanceId)) {
          expect(subjects.size, `seed ${seed}: ${instanceId}`).toBe(1);
        }
      }
    },
  );
});

describe('chaos against the run clock', () => {
  it.each(SCENARIO_SEEDS.slice(0, 60))(
    'after parts of random length never undo the answer, seed %i',
    async (seed) => {
      const random = createRandom(seed);
      let afterPartStarted = false;
      const afterLayers = Array.from(
        { length: 1 + random.integerBelow(4) },
        (_, layerIndex) => ({
          id: `slow_${layerIndex}`,
          after: () => {
            afterPartStarted = true;
            return sleep(random.integerBelow(120));
          },
        }),
      );
      const executionResult = await executeOrder(
        orderHandler({ runTimeout: 40, middleware: afterLayers }),
        { event: orderRequest(`clock-${seed}`) },
      );
      if (afterPartStarted) {
        // the executor had returned, so its answer stands however the after parts end
        expect(
          executionResult.ok &&
            executionResult.value.kind === 'produced' &&
            executionResult.value.state.lifecycle,
          `seed ${seed}`,
        ).toBe('success');
        return;
      }
      // the clock beat the executor itself, which a loaded machine can do
      expect(
        !executionResult.ok && executionResult.error.faultKind,
        `seed ${seed}`,
      ).toBe('run_timeout');
    },
  );
});
