import type { ArvoExecutionState } from 'arvo-core';

/**
 * What every executor in this run is given.
 *
 * Built by the mechanism, once per execution, through the factory — the
 * only way a handler is allowed to reach anything it did not bring with
 * it. Nothing here survives a suspension, because nothing here is built
 * except per delivery.
 */
export type DistributedDependencies = {
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
