import type { ArvoExecutionState } from 'arvo-core';

/**
 * What every executor in this run is given.
 *
 * Built by the mechanism, once per execution, through the factory — the
 * only way a handler may reach anything it did not bring with it. What
 * is behind each of these is the mechanism's business: a handler names
 * what it needs and never learns where it came from.
 */

/** The data this run is about, and what a handler may do to it. */
export type Catalogue = {
  /** Every item in a category, which is what a fan-out fans out over. */
  itemsIn(category: string): Promise<readonly string[]>;
  /** The categories one level under this one, which is what a walk descends. */
  childrenOf(category: string): Promise<readonly string[]>;
  /** How much of one item is held, which is what a check answers with. */
  heldOf(sku: string): Promise<number>;
  /** Takes some of what is held, which is a handler changing the world. */
  reserve(sku: string, wanted: number): Promise<number>;
};

/** What an executor in this run can reach. */
export type DistributedDependencies = {
  /**
   * The data, on a connection held for this execution alone.
   *
   * Scoped rather than shared: nothing live may survive a suspension,
   * and a connection taken per execution and given back with it is the
   * only shape where that holds by construction. A handler that leaked
   * one would exhaust the pool rather than slow down, which is a failure
   * a handler can see.
   */
  catalogue: Catalogue;

  /**
   * Which execution this was built for.
   *
   * Present even on the delivery that opens one, so a dependency keyed
   * on the execution — a lock, a lease, a scoped client — can be built
   * either way.
   */
  executionId: string;

  /** Which attempt built it, so a dependency may differ on a retry. */
  attempt: number;

  /**
   * What the execution remembers, or `null` where it has none yet.
   *
   * `null` is what a delivery opening an execution sees. Which it is
   * says whether this is opening work or picking up work under way.
   */
  resumed: ArvoExecutionState | null;
};
