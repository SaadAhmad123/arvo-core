import type { ArvoExecutionStateResolver } from '../../../src/ArvoEventHandler/types/execute.js';
import type { JSONObject } from '../../../src/types.js';

/**
 * A store a handler reaches through, and every way one can let it down.
 *
 * A handler is told nothing about what is behind this. It asks for one
 * identifier and judges whatever comes back, so every way a store can be
 * wrong has to be reachable from here: not answering, answering with
 * something that is not a record, answering with another execution's,
 * and answering differently the second time it is asked.
 */

/** How a store misbehaves, or nothing where it behaves. */
export type StoreFault =
  | { kind: 'unreachable'; as?: 'error' | 'rejection' | 'string' | 'null' }
  | { kind: 'returns'; row: JSONObject | null }
  | { kind: 'returnsOnce'; row: JSONObject | null }
  | { kind: 'mutates'; change: (row: JSONObject) => JSONObject };

export class ScenarioStore {
  /** What is committed, keyed as a mechanism would key it. */
  readonly rows = new Map<string, JSONObject>();

  /** Every identifier asked for, in order, so one read can be proven. */
  readonly reads: string[] = [];

  #fault: StoreFault | null = null;
  #spent = false;

  /** Makes the store behave badly, in one named way, until told otherwise. */
  misbehave(fault: StoreFault | null): this {
    this.#fault = fault;
    this.#spent = false;
    return this;
  }

  /** Commits a record, as a mechanism would once the handler produced one. */
  commit(row: JSONObject): this {
    this.rows.set(String(row.executionId), row);
    return this;
  }

  /** What this store hands a handler asking for one execution. */
  get resolver(): ArvoExecutionStateResolver {
    return ({ executionId }) => {
      this.reads.push(executionId);
      const fault = this.#fault;

      if (fault === null) return this.rows.get(executionId) ?? null;

      if (fault.kind === 'unreachable') {
        if (fault.as === 'rejection') {
          return Promise.reject(new Error('the store is unreachable'));
        }
        if (fault.as === 'string') throw 'the store is unreachable';
        if (fault.as === 'null') throw null;
        throw new Error('the store is unreachable');
      }

      if (fault.kind === 'returns') return fault.row;

      if (fault.kind === 'returnsOnce') {
        if (this.#spent) return this.rows.get(executionId) ?? null;
        this.#spent = true;
        return fault.row;
      }

      const held = this.rows.get(executionId);
      return held === undefined ? null : fault.change({ ...held });
    };
  }
}

/** A row that is shaped like nothing in particular. */
export const NOT_A_RECORD: JSONObject = { nothing: 'that is a record' };
