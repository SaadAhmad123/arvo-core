import type * as z from 'zod/v4/core';
import type { ArvoEvent } from '../../ArvoEvent/index.js';
import type { PromiseAble } from '../../types.js';
import type { ArvoExecutionContextTelemetry } from '../context/telemetry/index.js';
import type { ArvoExecutionState } from '../state/index.js';
import type { ArvoDependencies } from './supplied.js';

/**
 * What dependencies are opened and closed for.
 *
 * @typeParam TDataSchema - The state schema of the version that will run,
 * where one dependency serves one version. Omitted, `state.data` is
 * whatever a record holds and yours to narrow.
 */
export type ArvoDependencyScope<
  TDataSchema extends z.$ZodObject = z.$ZodObject,
> = {
  /** The event that caused this execution. */
  event: ArvoEvent;
  /** What it remembers, or `null` where it has none yet. Already validated. */
  state: ArvoExecutionState<TDataSchema> | null;
  /** The execution, whether or not a record exists for it yet. */
  executionId: string;
  /** Which attempt this is, counting from 0. */
  attempt: number;
  /**
   * Where this execution records.
   *
   * Record against it and a slow open is visible as one. The span is the
   * execution's, so what you write changes what a reader sees and
   * nothing about what the execution concludes.
   */
  telemetry: ArvoExecutionContextTelemetry;
};

/**
 * What an executor is given to work with, and how it is opened and closed.
 *
 * One object however many resources it holds, so the order they open in
 * is yours rather than the protocol's.
 *
 * Name the state schema of the version that will run and `scope.state.data`
 * is typed by it. Omit it — the ordinary case, since one of these serves
 * every version of a handler — and narrow the record yourself.
 *
 * `open` is called before the executor and `close` after the execution
 * ends, on every path out. **Both must be idempotent and `close` must be
 * safe on something never opened** — nothing tracks what it has already
 * called. See `docs/adr/011-dependency-lifetime.md`.
 *
 * @example
 * ```typescript
 * class Store implements IArvoEventHandlerDependency<{ db: Db }> {
 *   #db: Db | null = null;
 *
 *   async open({ executionId }: ArvoDependencyScope) {
 *     this.#db ??= await pool.connect(executionId);
 *   }
 *
 *   async close() {
 *     await this.#db?.release();
 *     this.#db = null;
 *   }
 *
 *   get attributes() {
 *     if (this.#db === null) throw new Error('this store is not open');
 *     return { db: this.#db };
 *   }
 * }
 * ```
 */
export interface IArvoEventHandlerDependency<
  TAttributes extends ArvoDependencies = ArvoDependencies,
  TDataSchema extends z.$ZodObject = z.$ZodObject,
> {
  /**
   * Makes this usable, before the executor is entered.
   *
   * @param scope - The execution being opened for.
   * @throws Anything. The execution fails as `dependency_resolution_failed`,
   * which is retry safe, and the executor is never entered.
   */
  open(scope: ArvoDependencyScope<TDataSchema>): PromiseAble<void>;

  /**
   * Lets go of what `open` took, once the execution has ended.
   *
   * Called even where `attributes` could not be read, since `open` had
   * already succeeded.
   *
   * @param scope - The same execution `open` was given.
   * @throws Anything. It is recorded and discarded: the execution has
   * concluded and nothing about it can change.
   */
  close(scope: ArvoDependencyScope<TDataSchema>): PromiseAble<void>;

  /**
   * What the executor finds on `ctx.dependencies`.
   *
   * Read once, after `open` and before the executor, so it may assume it
   * is open and is never charged for twice.
   *
   * @throws Anything. Treated as `open` failing, because the dependency
   * did not become usable either way — and `close` still runs.
   */
  readonly attributes: TAttributes;
}
