import type { ArvoExecutionState } from 'arvo-core';

/**
 * What every executor in this run is given to work with.
 *
 * Declared here so the handlers can name it without knowing where it
 * comes from. Each mechanism builds it from its own worker's scope and
 * hands it in through the factory, which is the only way a handler is
 * allowed to reach anything live.
 *
 * It is deliberately a real thing. A literal would make ADR-006's
 * requirement — that a resolved dependency is built for one execution
 * and discarded with it — impossible to test, because nothing would be
 * built and nothing would need discarding.
 */

/** What this run knows about what it is selling. */
export type Catalogue = {
  /** Every item in a category, which is what a fan-out fans out over. */
  itemsIn(category: string): Promise<readonly string[]>;
  /** What a category's children are, which is what a walk descends. */
  childrenOf(category: string): Promise<readonly string[]>;
  /** How much of one item is held, which is what a check answers with. */
  heldOf(sku: string): Promise<number>;
};

/** What an executor in this run can reach. */
export type DistributedDependencies = {
  /**
   * The catalogue, opened for this execution and closed with it.
   *
   * Scoped rather than shared: ADR-006 asks that nothing live survive a
   * suspension, and a connection built per execution is the only shape
   * where that holds by construction rather than by discipline.
   */
  catalogue: Catalogue;

  /**
   * Which execution this was built for.
   *
   * Carried so a dependency can be keyed on the execution — a lock, a
   * lease, a scoped client — including on the delivery that opens one,
   * where there is no record to read it from.
   */
  executionId: string;

  /**
   * Which attempt built it, so a dependency may differ on a retry: a
   * longer timeout, a different replica.
   */
  attempt: number;

  /**
   * Whether this execution was opened by what it was given, or resumed.
   *
   * `null` is absence, which is what a delivery opening an execution
   * sees. Which it is decides whether a factory is opening resources
   * for new work or picking up work already under way.
   */
  resumed: ArvoExecutionState | null;
};
