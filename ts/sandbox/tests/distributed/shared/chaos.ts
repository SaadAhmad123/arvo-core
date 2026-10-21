import {
  type ArvoEvent,
  ArvoEventSerializer,
  createArvoEventFactory,
  deriveArvoExecutionId,
  type JSONObject,
} from 'arvo-core';
import type { Pool } from 'pg';
import { categoryWalkV1 } from '../../../src/distributed/handler/com_category_walk/contract.js';
import { inventoryCheckV1 } from '../../../src/distributed/handler/com_inventory_check/contract.js';
import {
  comparablePayload,
  comparableRecord,
} from '../../../src/distributed/replay/comparison.js';
import {
  FORGED_HELD,
  type InjectedFailure,
} from '../../../src/distributed/shared/delivery-middleware.js';
import type { Expected } from './injection.js';

/**
 * Many workflows at once, each with a failure of its own injected through
 * a layer, and what the protocol must make of every one of them — the
 * same plan and the same expectations under every mechanism.
 *
 * The plan is drawn from a seed, printed by every spec that uses one, so
 * a run that failed can be run again exactly: `CHAOS_SEED=<seed>`.
 */

const WIRE = new ArvoEventSerializer({ type: 'arvoevent' });

/** Where every chaos workflow answers. Not a handler's type, as a sender must ensure. */
export const CHAOS_CALLER = 'com.test.chaos';

/**
 * An item held short, so no inventory check ever reserves any of it and
 * every run of a check reads the same stock under every mechanism.
 */
export const SHORT_SKU = 'sku-chaos-short';

/**
 * A category chain two levels deep, one child at each level, so a walk
 * is five deliveries one after another: down to the leaf and back up.
 *
 * One child rather than several on purpose. Two answers reaching one
 * parent at once is a race the plain loop loses one of, whatever the
 * layers do, and this exists to test the layers.
 */
export const WALK_ROOT = 'chaos/chain';
const WALK_BELOW_ROOT = ['chaos/chain/a', 'chaos/chain/a/b'];

/** How many nodes a walk of {@link WALK_ROOT} visits, itself included. */
export const WALK_VISITS = 1 + WALK_BELOW_ROOT.length;

/** Puts the items chaos workflows read into the catalogue, held as they need. */
export const stockTheChaosShelf = async (pool: Pool): Promise<void> => {
  await pool.query(
    `INSERT INTO catalogue (sku, category, held) VALUES ($1, 'chaos/short', 0)
     ON CONFLICT (sku) DO UPDATE SET held = 0, category = 'chaos/short'`,
    [SHORT_SKU],
  );
  for (const leaf of WALK_BELOW_ROOT) {
    await pool.query(
      `INSERT INTO catalogue (sku, category, held) VALUES ($1, $2, 1)
       ON CONFLICT (sku) DO UPDATE SET category = $2`,
      [`sku-${leaf.replaceAll('/', '-')}`, leaf],
    );
  }
};

// ------------------------------------------------------------------ seed

/**
 * The seed this run draws its plan from: `CHAOS_SEED` where set, a fresh
 * one otherwise. Printed, so a failing run can be reproduced.
 *
 * @param specName - Which spec is drawing, for the printed line.
 */
export const chaosSeed = (specName: string): number => {
  const fromEnvironment = Number(process.env.CHAOS_SEED);
  const seed = Number.isInteger(fromEnvironment)
    ? fromEnvironment
    : Math.floor(Math.random() * 2 ** 31);
  console.info(
    `[middleware chaos] ${specName}: seed ${seed} (reproduce with CHAOS_SEED=${seed})`,
  );
  return seed;
};

/** A deterministic stream of numbers in [0, 1) from one seed (mulberry32). */
export const seededRandom = (seed: number): (() => number) => {
  let current = seed >>> 0;
  return () => {
    current = (current + 0x6d2b79f5) >>> 0;
    let mixed = current;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
};

// ------------------------------------------------------------------ cases

/** One failure a chaos workflow may be given, and where it must end. */
export type ChaosCase = {
  readonly name: string;
  /** What is injected into every delivery of the workflow; nothing where null. */
  readonly failure: InjectedFailure | null;
  readonly expected: Expected;
};

const ANSWERED: Expected = { lifecycle: 'success', answeredWithError: false };
const WORK_FAILED: Expected = { lifecycle: 'error', answeredWithError: true };
const ABANDONED: Expected = { lifecycle: 'failure', answeredWithError: true };

/**
 * Every failure the chaos plan draws from, aimed at the inventory check.
 *
 * Every timing is against the check's run clock of five seconds.
 */
export const CHAOS_CASES: readonly ChaosCase[] = [
  { name: 'nothing injected', failure: null, expected: ANSWERED },
  {
    name: 'a before part that throws',
    failure: { kind: 'throw_before' },
    expected: WORK_FAILED,
  },
  {
    name: 'a before part that faults with no retry',
    failure: { kind: 'fault_before', retryable: false },
    expected: ABANDONED,
  },
  {
    name: 'a before part that faults retryably on the first attempt',
    failure: { kind: 'fault_before', retryable: true, failingAttempts: 1 },
    expected: ANSWERED,
  },
  {
    name: 'a before part that faults retryably on the first two attempts',
    failure: { kind: 'fault_before', retryable: true, failingAttempts: 2 },
    expected: ANSWERED,
  },
  {
    name: 'a before part that faults retryably on every attempt',
    failure: { kind: 'fault_before', retryable: true },
    expected: ABANDONED,
  },
  {
    name: 'a before part cut by the run clock on the first attempt',
    failure: { kind: 'slow_before', ms: 5_500, slowAttempts: 1 },
    expected: ANSWERED,
  },
  {
    name: 'a slow before part inside the run clock',
    failure: { kind: 'slow_before', ms: 1_500 },
    expected: ANSWERED,
  },
  {
    name: 'an after part that throws',
    failure: { kind: 'throw_after' },
    expected: ANSWERED,
  },
  {
    name: 'an after part that faults',
    failure: { kind: 'fault_after' },
    expected: ANSWERED,
  },
  {
    name: 'an after part that hangs past the run clock',
    failure: { kind: 'hang_after', ms: 5_500 },
    expected: ANSWERED,
  },
  {
    name: 'a slow after part inside the run clock',
    failure: { kind: 'hang_after', ms: 800 },
    expected: ANSWERED,
  },
  {
    name: 'an after part that writes the record',
    failure: { kind: 'write_after' },
    expected: ANSWERED,
  },
  {
    name: 'a layer that tries to change what it may only read',
    failure: { kind: 'tamper' },
    expected: ANSWERED,
  },
  {
    name: 'a layer that answers for the executor',
    failure: { kind: 'answer_from_layer' },
    expected: ANSWERED,
  },
  {
    name: 'a middleware-data key written twice',
    failure: { kind: 'duplicate_key' },
    expected: ABANDONED,
  },
  {
    name: 'a layer supplied twice under one identifier',
    failure: { kind: 'duplicate_id' },
    expected: ABANDONED,
  },
  {
    name: 'a way to make a layer that throws',
    failure: { kind: 'factory_throws' },
    expected: ABANDONED,
  },
  {
    name: 'a way to make a layer that returns none',
    failure: { kind: 'factory_returns_nothing' },
    expected: ABANDONED,
  },
];

/**
 * A way to make a layer that fails for some workflows and not others:
 * half the cases refuse at the factory, half are clean, drawn at random.
 */
export const INTERMITTENT_FACTORY_CASES: readonly ChaosCase[] = [
  ...CHAOS_CASES.filter(
    (one) =>
      one.failure?.kind === 'factory_throws' ||
      one.failure?.kind === 'factory_returns_nothing',
  ),
  { name: 'nothing injected', failure: null, expected: ANSWERED },
  { name: 'nothing injected', failure: null, expected: ANSWERED },
];

// ------------------------------------------------------------------ plan

/** One chaos workflow: the event that opens it and the case it was given. */
export type ChaosWorkflow = {
  readonly event: ArvoEvent;
  readonly chaosCase: ChaosCase;
};

/**
 * A fresh request to the inventory check, for the item held short.
 *
 * @param subject - The workflow's subject, which aims its failure.
 */
const aShortCheck = (subject: string): ArvoEvent =>
  createArvoEventFactory(inventoryCheckV1).createInput({
    source: CHAOS_CALLER,
    subject,
    to: inventoryCheckV1.type,
    data: { sku: SHORT_SKU, wanted: 1 },
  });

/**
 * A plan of `count` inventory-check workflows: every case at least once,
 * the rest drawn at random, all in a seeded order.
 *
 * @param param.seed - What the plan is drawn from.
 * @param param.count - How many workflows; at least every case once.
 * @param param.label - Part of every subject, so two plans never share one.
 * @param param.cases - What to draw from; every chaos case where omitted.
 */
export const planChaos = (param: {
  seed: number;
  count: number;
  label: string;
  cases?: readonly ChaosCase[];
}): readonly ChaosWorkflow[] => {
  const random = seededRandom(param.seed);
  const cases = param.cases ?? CHAOS_CASES;
  const drawn = [...cases];
  while (drawn.length < param.count) {
    drawn.push(cases[Math.floor(random() * cases.length)] ?? CHAOS_CASES[0]);
  }
  // Fisher-Yates, from the same stream
  for (let position = drawn.length - 1; position > 0; position--) {
    const swapWith = Math.floor(random() * (position + 1));
    const held = drawn[position];
    drawn[position] = drawn[swapWith] ?? drawn[position];
    drawn[swapWith] = held ?? drawn[swapWith];
  }
  const runMark = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
  return drawn.map((chaosCase, position) => ({
    chaosCase,
    event: aShortCheck(
      `chaos-${param.label}-${param.seed}-${position}-${runMark}`,
    ),
  }));
};

/** What a plan aims at each workflow, for the delivery middleware. */
export const failuresOf = (
  plan: readonly ChaosWorkflow[],
): ReadonlyMap<string, InjectedFailure> =>
  new Map(
    plan.flatMap(({ event, chaosCase }) =>
      chaosCase.failure === null ? [] : [[event.subject, chaosCase.failure]],
    ),
  );

/**
 * A walk down the chaos chain and back, as one workflow of five deliveries.
 *
 * @param label - Part of the subject, so two walks never share one.
 */
export const aChaosWalk = (label: string): ArvoEvent =>
  createArvoEventFactory(categoryWalkV1).createInput({
    source: CHAOS_CALLER,
    subject: `chaos-walk-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    to: categoryWalkV1.type,
    data: { category: WALK_ROOT, remaining: WALK_BELOW_ROOT.length },
  });

// ------------------------------------------------------------------ ending

/** Where one workflow ended, read the same way under every mechanism. */
export type WorkflowEnding = {
  /** How the run ended, or why it did not. */
  readonly runKind: string;
  /** Every event published to the caller, in the event's own format. */
  readonly published: readonly string[];
  /** The opening execution's record as it rests, if it has one. */
  readonly record: JSONObject | null;
};

/** The opening execution of a workflow, which its record is stored under. */
export const openingExecutionOf = (event: ArvoEvent): Promise<string> =>
  deriveArvoExecutionId(event);

/**
 * Everything a workflow ended at that does not match its case: empty
 * where it ended where the protocol says.
 *
 * @param workflow - The workflow and its case.
 * @param ending - Where it ended.
 */
export const discrepanciesOf = async (
  workflow: ChaosWorkflow,
  ending: WorkflowEnding,
): Promise<readonly string[]> => {
  const { chaosCase, event } = workflow;
  const where = `${event.subject} [${chaosCase.name}]`;
  const found: string[] = [];

  if (ending.runKind !== 'answered') {
    found.push(`${where}: the run ended ${ending.runKind}, not answered`);
  }
  if (ending.published.length !== 1) {
    found.push(
      `${where}: ${ending.published.length} events were published to the caller, not one`,
    );
  }

  const lifecycle = ending.record?.lifecycle ?? null;
  if (lifecycle !== chaosCase.expected.lifecycle) {
    found.push(
      `${where}: the record rests at ${String(lifecycle)}, not ${chaosCase.expected.lifecycle}`,
    );
  }

  const answers = await Promise.all(
    ending.published.map((payload) => WIRE.deserialize(payload)),
  );
  for (const answer of answers) {
    if (answer.to !== CHAOS_CALLER) {
      found.push(`${where}: an answer went to ${answer.to}, not the caller`);
    }
    const isError = answer.type === inventoryCheckV1.error.type;
    if (isError !== chaosCase.expected.answeredWithError) {
      found.push(`${where}: the caller was answered with ${answer.type}`);
    }
    if (!isError && answer.type !== 'evt_inventory_checked') {
      found.push(`${where}: the caller was answered with ${answer.type}`);
    }
    const held: unknown = Reflect.get(answer.data, 'held');
    if (!isError && held !== 0) {
      found.push(
        `${where}: the answer says ${String(held)} held, which the executor never said${held === FORGED_HELD ? ' — a layer wrote it' : ''}`,
      );
    }
  }

  if (chaosCase.expected.lifecycle === 'success') {
    const remembered = ending.record?.data;
    const expectedMemory = { sku: SHORT_SKU, held: 0, reserved: 0 };
    if (JSON.stringify(remembered) !== JSON.stringify(expectedMemory)) {
      found.push(
        `${where}: the record remembers ${JSON.stringify(remembered)}, not what the executor wrote (${JSON.stringify(expectedMemory)})`,
      );
    }
  }

  return found;
};

/**
 * Every workflow of a plan that did not end where the protocol says.
 *
 * @param plan - The workflows and their cases.
 * @param endings - Where each ended, in the plan's order.
 */
export const discrepanciesAcross = async (
  plan: readonly ChaosWorkflow[],
  endings: readonly WorkflowEnding[],
): Promise<readonly string[]> =>
  (
    await Promise.all(
      plan.map((workflow, position) => {
        const ending = endings[position];
        return ending === undefined
          ? [`${workflow.event.subject}: no ending was read`]
          : discrepanciesOf(workflow, ending);
      }),
    )
  ).flat();

/**
 * One published event as two mechanisms can be compared: what is minted
 * per event set aside, and the stack of a handler error event too.
 *
 * The stack is where the error was built, read off the call path, and
 * the call path runs through each mechanism's own adapter — so it names
 * the mechanism rather than anything the handler decided. Its message,
 * which is the decision, is still compared.
 */
const comparablePublished = (payload: string): string => {
  // parsed afresh from the payload, so nothing shared is changed here
  const comparable = comparablePayload(payload);
  if (comparable !== null && typeof comparable === 'object') {
    const data: unknown = Reflect.get(comparable, 'data');
    if (data !== null && typeof data === 'object') {
      Reflect.deleteProperty(data, 'error_stack');
    }
  }
  return JSON.stringify(comparable);
};

/**
 * One workflow's ending as two mechanisms can be compared: its record
 * and what it published, with what is minted per event set aside, as
 * the cross-mechanism replay compares them.
 */
export const comparableEnding = (ending: WorkflowEnding): unknown => ({
  runKind: ending.runKind,
  record: ending.record === null ? null : comparableRecord(ending.record),
  published: ending.published.map(comparablePublished).sort(),
});

/** How many workflows of a plan were given each case, for a spec to print. */
export const tallyOf = (plan: readonly ChaosWorkflow[]): string => {
  const countByCase = new Map<string, number>();
  for (const { chaosCase } of plan) {
    countByCase.set(chaosCase.name, (countByCase.get(chaosCase.name) ?? 0) + 1);
  }
  return [...countByCase]
    .map(([name, count]) => `${count} × ${name}`)
    .join('; ');
};

/**
 * What a walk's layers do at every step of its chain, one per walk in
 * turn: slow it, cut it, fault it once retryably, fail after it. Not one
 * of them may change where the walk ends. The walk's run clock is
 * fifteen seconds.
 */
export const WALK_FAILURES: readonly InjectedFailure[] = [
  { kind: 'slow_before', ms: 1_000 },
  { kind: 'hang_after', ms: 16_000 },
  { kind: 'fault_before', retryable: true, failingAttempts: 1 },
  { kind: 'throw_after' },
];

/** The walks of a chain test, each given the next of {@link WALK_FAILURES}. */
export const walkFailuresOf = (
  walks: readonly ArvoEvent[],
): ReadonlyMap<string, InjectedFailure> =>
  new Map(
    walks.map((walk, position) => [
      walk.subject,
      WALK_FAILURES[position % WALK_FAILURES.length] ?? { kind: 'throw_after' },
    ]),
  );

/**
 * Everything a walk ended at that it should not have: empty where it
 * answered its caller once, having visited the whole chain.
 *
 * @param walk - The event that opened it.
 * @param runKind - How its run ended.
 * @param published - What was published to the caller.
 */
export const walkDiscrepanciesOf = async (
  walk: ArvoEvent,
  runKind: string,
  published: readonly string[],
): Promise<readonly string[]> => {
  const found: string[] = [];
  if (runKind !== 'answered') found.push(`${walk.subject}: ended ${runKind}`);
  if (published.length !== 1) {
    found.push(`${walk.subject}: published ${published.length} events`);
  }
  for (const payload of published) {
    const answer = await WIRE.deserialize(payload);
    const visited: unknown = Reflect.get(answer.data, 'visited');
    if (answer.type !== 'evt_category_walked' || visited !== WALK_VISITS) {
      found.push(
        `${walk.subject}: answered ${answer.type} having visited ${String(visited)}`,
      );
    }
  }
  return found;
};
