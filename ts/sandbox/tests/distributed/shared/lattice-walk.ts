import {
  type ArvoDependencyScope,
  type ArvoEvent,
  createArvoEventFactory,
  type IArvoEventHandlerDependency,
  type JSONObject,
} from 'arvo-core';
import type { Pool } from 'pg';
import {
  orderFulfilContract,
  orderFulfilV1,
} from '../../../src/distributed/handler/com_order_fulfil/contract.js';
import type {
  Catalogue,
  DistributedDependencies,
} from '../../../src/distributed/handler/dependencies.js';
import { PostgresCatalogue } from '../../../src/distributed/shared/catalogue.js';
import type { LatticeDispatcher } from '../../../src/distributed/shared/dispatcher.js';
import { handlerFor } from '../../../src/distributed/shared/routing.js';
import { uniqueSuffix } from './unique-suffix.js';

/**
 * A whole run carried out in memory, one event at a time, through
 * whatever way of entering a handler a test hands it.
 *
 * No mechanism and no record store: records are kept in a map and read
 * back on the next delivery, which is all a handler asks of a store.
 * What is left is the difference between two ways of entering handlers,
 * and nothing else, which is what a differential test needs.
 */

/** What entering a handler hands back, the dispatcher's type being the handler's. */
export type Entered = Awaited<ReturnType<LatticeDispatcher['tryExecute']>>;

/** How a handler reads its record, as the dispatcher passes it on. */
export type StateReader = Parameters<
  LatticeDispatcher['tryExecute']
>[0]['state'];

/** One way of entering a handler with one event. */
export type Enter = (event: ArvoEvent, state: StateReader) => Promise<Entered>;

/** One delivery made during a walk, and what came of it. */
export type WalkStep = {
  readonly event: ArvoEvent;
  readonly entered: Entered;
};

/** Everything one walk did and left behind. */
export type Walk = {
  /** Every delivery, in the order made. */
  readonly steps: readonly WalkStep[];
  /** Every record, by execution, as last written. */
  readonly records: ReadonlyMap<string, JSONObject>;
  /** Every event that left the lattice by its domain. */
  readonly left: readonly ArvoEvent[];
  /** Every event addressed to nothing here, which a run answers its caller with. */
  readonly outside: readonly ArvoEvent[];
};

/** More deliveries than any run here makes, so a loop is caught rather than waited on. */
const MOST_STEPS = 500;

/**
 * Carries one run out from its opening event until nothing is left.
 *
 * Routing is the mechanisms' own, so the walk leaves the lattice and
 * answers outside exactly where they do; only entering is the caller's.
 *
 * @param opening - The event the run starts from.
 * @param enter - How each handler is entered.
 */
export const walkLattice = async (
  opening: ArvoEvent,
  enter: Enter,
): Promise<Walk> => {
  const records = new Map<string, JSONObject>();
  const steps: WalkStep[] = [];
  const left: ArvoEvent[] = [];
  const outside: ArvoEvent[] = [];
  const waiting: ArvoEvent[] = [opening];

  for (let next = waiting.shift(); next !== undefined; next = waiting.shift()) {
    if (next.domain !== null) {
      left.push(next);
      continue;
    }
    if (handlerFor(next.to) === null) {
      outside.push(next);
      continue;
    }
    if (steps.length >= MOST_STEPS) {
      throw new Error(`the walk made more than ${MOST_STEPS} deliveries`);
    }

    const entered = await enter(
      next,
      ({ executionId }) => records.get(executionId) ?? null,
    );
    steps.push({ event: next, entered });
    if (!entered.ok || entered.value.kind !== 'produced') continue;

    const { executionId } = entered.value.state;
    if (typeof executionId !== 'string') {
      throw new Error('a handler wrote a record naming no execution');
    }
    records.set(executionId, entered.value.state);
    waiting.push(...entered.value.events);
  }

  return { steps, records, left, outside };
};

/** Narrow and shallow, so a walk is quick and still fans out and descends. */
export const anOrder = (label: string): ArvoEvent =>
  createArvoEventFactory(orderFulfilV1).createInput({
    source: 'com.test.dispatcher',
    subject: `dispatch-${label}-${Date.now()}-${uniqueSuffix(6)}`,
    to: orderFulfilContract.type,
    data: {
      orderRef: `order-${label}`,
      category: 'orders',
      width: 2,
      depth: 2,
    },
  });

/**
 * The catalogue, with the stock it holds fixed for the life of one
 * instance.
 *
 * Reads what is held from Postgres the first time an item is asked
 * about and takes from that copy afterwards, writing nothing back. Two
 * walks given an instance each therefore start from the same stock and
 * leave it as they found it, so whatever differs between them is the
 * way they entered handlers.
 */
export class FrozenStockCatalogue
  implements IArvoEventHandlerDependency<DistributedDependencies>
{
  readonly #underlying: PostgresCatalogue;
  readonly #held = new Map<string, number>();
  readonly #takenByKey = new Map<string, number>();

  constructor(pool: Pool) {
    this.#underlying = new PostgresCatalogue(pool);
  }

  open(scope: ArvoDependencyScope): Promise<void> {
    return this.#underlying.open(scope);
  }

  close(): Promise<void> {
    return this.#underlying.close();
  }

  get attributes(): DistributedDependencies {
    const underlying = this.#underlying.attributes;
    return { ...underlying, catalogue: this.#frozen(underlying.catalogue) };
  }

  #frozen(underlying: Catalogue): Catalogue {
    const heldOf = async (sku: string): Promise<number> => {
      const known = this.#held.get(sku);
      if (known !== undefined) return known;
      const read = await underlying.heldOf(sku);
      this.#held.set(sku, read);
      return read;
    };
    return {
      itemsIn: (category) => underlying.itemsIn(category),
      childrenOf: (category) => underlying.childrenOf(category),
      heldOf,
      reserve: async (sku, wanted, idempotencyKey) => {
        const already = this.#takenByKey.get(idempotencyKey);
        if (already !== undefined) return already;
        const taking = Math.min(await heldOf(sku), wanted);
        this.#held.set(sku, (await heldOf(sku)) - taking);
        this.#takenByKey.set(idempotencyKey, taking);
        return taking;
      },
    };
  }
}
