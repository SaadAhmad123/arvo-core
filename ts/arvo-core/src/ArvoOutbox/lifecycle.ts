import { err, ok } from 'neverthrow';
import { fromNeverthrow } from '../result.js';
import type { AsyncResult, PromiseAble, Result } from '../types.js';
import {
  ArvoOutboxLifecycleError,
  type ArvoOutboxLifecycleErrorKind,
} from './errors.js';

/** Where an outbox is in its life, and the resources it holds while open. */
type OutboxPhase<Resources> =
  | { readonly name: 'unopened' }
  | { readonly name: 'opening'; readonly untilOpen: Promise<Resources> }
  | { readonly name: 'open'; readonly resources: Resources }
  | { readonly name: 'closed' };

/**
 * The open and close of your own {@link IArvoOutbox}: it holds whatever your
 * outbox acquires when it is opened, such as a connection pool, and hands it
 * to an operation only while the outbox is open.
 *
 * An outbox using it is unopened until `open()`, open until `close()`, and
 * closed for good after. Both may be called any number of times, at once or
 * one after another:
 *
 * - opening acquires once, and every caller waits for that one opening;
 * - where acquiring throws, the outbox stays unopened, so it may be opened
 *   again;
 * - closing takes effect at once, so nothing opens after it, and releases
 *   once, waiting first for any opening under way so that nothing it
 *   acquires is left unreleased; the outbox is closed even where releasing
 *   throws;
 * - opening a closed outbox is refused, and so is every operation called
 *   before the outbox is open or once it is closed, each with an
 *   {@link ArvoOutboxLifecycleError} saying what to do.
 *
 * Each `tryX` answers a refusal as a value, and each `X` throws it.
 * Acquiring and releasing may each answer directly or through a promise,
 * and what either throws is passed on as it was thrown. Opening and closing
 * always answer through a promise, so await them.
 *
 * @example
 * ```typescript
 * class PostgresOutbox implements IArvoOutbox {
 *   private readonly lifecycle = new ArvoOutboxLifecycle<Pool>('PostgresOutbox');
 *
 *   constructor(private readonly config: PoolConfig) {}
 *
 *   async open() {
 *     await this.lifecycle.open(async () => {
 *       const pool = new Pool(this.config);
 *       await pool.query('select 1');
 *       return pool;
 *     });
 *   }
 *
 *   async close() {
 *     await this.lifecycle.close((pool) => pool.end());
 *   }
 *
 *   async readLatestState(executionId: string) {
 *     const pool = this.lifecycle.resourcesFor('readLatestState');
 *     // read the latest state from the pool
 *   }
 *
 *   // the other operations, each starting with resourcesFor
 * }
 * ```
 */
export class ArvoOutboxLifecycle<Resources> {
  private phase: OutboxPhase<Resources> = { name: 'unopened' };

  /**
   * @param outboxName - How your outbox is named in what it answers when an
   * operation is called outside its open life.
   */
  constructor(private readonly outboxName: string) {}

  /**
   * Opens the outbox, acquiring its resources once, and answers a refusal as
   * a value. Where it is already open, answers at once; where an opening is
   * under way, answers when that opening does.
   *
   * @param acquire - Acquires what your outbox holds while open, directly or through a promise.
   * @returns Nothing once open, or an {@link ArvoOutboxLifecycleError} where the outbox is closed.
   * @throws Whatever `acquire` throws, as it was thrown.
   */
  async tryOpen(
    acquire: () => PromiseAble<Resources>,
  ): AsyncResult<void, ArvoOutboxLifecycleError> {
    if (this.phase.name === 'open') return fromNeverthrow(ok(undefined));
    if (this.phase.name === 'closed') {
      return fromNeverthrow(err(this.lifecycleError('closed', 'open')));
    }
    if (this.phase.name === 'unopened') {
      this.phase = {
        name: 'opening',
        untilOpen: this.acquireResources(acquire),
      };
    }
    await this.phase.untilOpen;
    return fromNeverthrow(ok(undefined));
  }

  /**
   * {@link ArvoOutboxLifecycle.tryOpen}, throwing a refusal.
   *
   * @param acquire - Acquires what your outbox holds while open, directly or through a promise.
   * @throws {ArvoOutboxLifecycleError} Where the outbox is closed.
   * @throws Whatever `acquire` throws, as it was thrown.
   */
  async open(acquire: () => PromiseAble<Resources>): Promise<void> {
    const openResult = await this.tryOpen(acquire);
    if (!openResult.ok) throw openResult.error;
  }

  /**
   * Closes the outbox for good, at once, and releases its resources once
   * where it holds any or an opening under way acquires them. Closing is
   * never refused, so it answers nothing but success as a value.
   *
   * @param release - Releases what your outbox acquired, directly or through a promise.
   * @returns Nothing, once closed.
   * @throws Whatever `release` throws, as it was thrown; the outbox is closed regardless.
   */
  async tryClose(
    release: (resources: Resources) => PromiseAble<void>,
  ): AsyncResult<void, ArvoOutboxLifecycleError> {
    const phaseBeforeClosing = this.phase;
    this.phase = { name: 'closed' };
    if (phaseBeforeClosing.name === 'open') {
      await release(phaseBeforeClosing.resources);
    } else if (phaseBeforeClosing.name === 'opening') {
      await this.releaseOnceOpened(phaseBeforeClosing.untilOpen, release);
    }
    return fromNeverthrow(ok(undefined));
  }

  /**
   * {@link ArvoOutboxLifecycle.tryClose}, throwing a refusal.
   *
   * @param release - Releases what your outbox acquired, directly or through a promise.
   * @throws Whatever `release` throws, as it was thrown; the outbox is closed regardless.
   */
  async close(
    release: (resources: Resources) => PromiseAble<void>,
  ): Promise<void> {
    const closeResult = await this.tryClose(release);
    if (!closeResult.ok) throw closeResult.error;
  }

  /**
   * Your outbox's resources, for an operation to use, or why it cannot use
   * them, as a value.
   *
   * @param operationName - The operation asking, named in the error.
   * @returns The resources while open, or an {@link ArvoOutboxLifecycleError} saying to open the outbox, to await its opening, or to build a new one.
   */
  tryResourcesFor(
    operationName: string,
  ): Result<Resources, ArvoOutboxLifecycleError> {
    switch (this.phase.name) {
      case 'open':
        return fromNeverthrow(ok(this.phase.resources));
      case 'opening':
        return fromNeverthrow(
          err(this.lifecycleError('still_opening', operationName)),
        );
      case 'unopened':
        return fromNeverthrow(
          err(this.lifecycleError('not_open', operationName)),
        );
      case 'closed':
        return fromNeverthrow(
          err(this.lifecycleError('closed', operationName)),
        );
    }
  }

  /**
   * {@link ArvoOutboxLifecycle.tryResourcesFor}, throwing why the resources
   * cannot be used.
   *
   * @param operationName - The operation asking, named in the error.
   * @throws {ArvoOutboxLifecycleError} Where the outbox is not open.
   */
  resourcesFor(operationName: string): Resources {
    const resourcesResult = this.tryResourcesFor(operationName);
    if (!resourcesResult.ok) throw resourcesResult.error;
    return resourcesResult.value;
  }

  /**
   * Acquires the resources and answers them, leaving the outbox open, or
   * unopened where acquiring throws, unless it was closed meanwhile.
   */
  private async acquireResources(
    acquire: () => PromiseAble<Resources>,
  ): Promise<Resources> {
    // tryOpen() stores this promise as the opening before acquire runs, so a throw from acquire, even an immediate one, lands after it
    await Promise.resolve();
    try {
      const resources = await acquire();
      if (this.phase.name === 'opening') {
        this.phase = { name: 'open', resources };
      }
      return resources;
    } catch (error_) {
      if (this.phase.name === 'opening') this.phase = { name: 'unopened' };
      throw error_;
    }
  }

  /** Waits for an opening closing overtook, and releases what it acquired, if anything. */
  private async releaseOnceOpened(
    untilOpen: Promise<Resources>,
    release: (resources: Resources) => PromiseAble<void>,
  ): Promise<void> {
    let acquiredResources: Resources;
    try {
      acquiredResources = await untilOpen;
    } catch {
      // the opening acquired nothing, and whoever opened is told why
      return;
    }
    await release(acquiredResources);
  }

  /** The error for this outbox, of `kind`, met by `operationName`. */
  private lifecycleError(
    kind: ArvoOutboxLifecycleErrorKind,
    operationName: string,
  ): ArvoOutboxLifecycleError {
    return new ArvoOutboxLifecycleError({
      kind,
      outboxName: this.outboxName,
      operationName,
    });
  }
}
