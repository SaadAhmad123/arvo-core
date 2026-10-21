import type * as z from 'zod/v4/core';
import type { VersionedArvoContract } from '../../ArvoContract/versioned/index.js';
import type { ArvoEvent } from '../../ArvoEvent/index.js';
import type { ArvoSemanticVersion } from '../../semver/index.js';
import { arvoIdempotencyKeysFor } from '../context/idempotency.js';
import { ArvoExecutionContext } from '../context/index.js';
import type { ArvoContextState } from '../context/types.js';
import { buildHandlerErrorEvent } from '../emission/handler-error.js';
import { resolveEmissionTarget } from '../emission/target.js';
import { createArvoHandlerFault } from '../fault/factory.js';
import { ArvoHandlerFault } from '../fault/index.js';
import { ARVO_ANY_STATE_SCHEMA } from '../helpers/defaults.js';
import { disagreementsWithInitEvent } from '../state/agreement.js';
import { collectResponse } from '../state/collect.js';
import { ArvoExecutionStateValidationError } from '../state/errors.js';
import {
  createFollowupArvoExecutionState,
  createInitArvoExecutionState,
} from '../state/factory.js';
import type { ArvoExecutionState } from '../state/index.js';
import { atNextRevision } from '../state/revision.js';
import type { ArvoExecutionStateSerializerError } from '../state/serializer/errors.js';
import { mutateState } from '../state/utils.js';
import type {
  ArvoDependencyScope,
  IArvoEventHandlerDependency,
} from '../types/dependency.js';
import type {
  ArvoEventHandlerExecuteResponse,
  ArvoEventHandlerExecutor,
  ArvoExecutorEmission,
} from '../types/execute.js';
import type { ArvoEventHandlerMiddlewareEntry } from '../types/middleware.js';
import type { ArvoEventHandlerOptions } from '../types/options.js';
import type { ArvoServiceMap } from '../types/services.js';
import type {
  ArvoDependencies,
  ArvoMechanismHooks,
} from '../types/supplied.js';
import { ArvoEventDepthValidator } from '../validators/depth/index.js';
import { tryCreateArvoComposedMiddleware } from './composed-middleware/factory.js';
import type { ArvoComposedMiddleware } from './composed-middleware/index.js';
import {
  alreadySeen,
  refuseMisaddressed,
  refuseOutlived,
  refuseTerminal,
  refuseUnawaited,
} from './gate.js';
import { refusalFrom } from './middleware-refusal.js';
import {
  collectBatch,
  recordToCommit,
  refuseBatch,
  settleRecord,
  writeRecord,
} from './returns.js';
import {
  describeExecution,
  markCollection,
  markExecutorRan,
  markMiddlewareRan,
  markOutcome,
  markStage,
  markSwallowed,
} from './telemetry.js';
import type {
  ArvoEventHandlerVersionExecuteParam,
  ArvoEventHandlerVersionParam,
  ArvoExecutorRun,
  ArvoGateRefusal,
} from './types.js';

/**
 * One version of a handler, and everything one execution of it does.
 *
 * Judges whether an execution may proceed, builds what the executor can
 * know and do, runs it under the time one attempt is allowed, judges what
 * it returned, and says what to publish and what to commit. Holds nothing
 * between executions and reaches no store.
 *
 * Two things it does not do. It does not decide which version runs: the
 * event is classified and validated against the contracts before one of
 * these is reached, so an event arriving here is one this version
 * declares. And it publishes and commits nothing itself — it says what to
 * do with both, and whatever runs the handler does it, together.
 *
 * @example
 * ```typescript
 * const version = new ArvoEventHandlerVersion({
 *   contracts: { self: orderContract.versions['1.0.0'], services },
 *   options: resolvedOptions,
 *   state: z.object({ orderId: z.string() }),
 *   execute: async (ctx) => {
 *     await ctx.setState({ data: { orderId: ctx.state.initEvent.data.id } });
 *     return ctx.build({ type: 'com_payment_charge', data: { amount: 10 } });
 *   },
 * });
 *
 * const response = await version.execute({
 *   entry: 'init',
 *   event: initEvent,
 *   state: null,
 *   executionId,
 *   attempt: 0,
 *   dependencies: { db },
 *   hooks: {},
 *   telemetry,
 * });
 * if (response.kind === 'produced') {
 *   await commit(response.state, response.events);
 * }
 * ```
 */
export class ArvoEventHandlerVersion<
  TSelf extends VersionedArvoContract = VersionedArvoContract,
  TServices extends ArvoServiceMap = ArvoServiceMap,
  TDataSchema extends z.$ZodObject = z.$ZodObject,
  TDependencies extends ArvoDependencies = ArvoDependencies,
  TMechanismHooks extends ArvoMechanismHooks = ArvoMechanismHooks,
> {
  /** This version of the contract implemented, and what it may send to. */
  readonly contracts: {
    readonly self: TSelf;
    readonly services: Readonly<TServices>;
  };

  /** Every option in force for this version, already settled. */
  readonly options: ArvoEventHandlerOptions;

  /**
   * The schema governing what this version remembers, declared as `state`.
   *
   * Every write an executor makes is checked against it, and a stored
   * record is read back under it — which is why a change to it must stay
   * compatible with the records already in a store.
   */
  readonly dataSchema: TDataSchema;

  /**
   * Whether {@link dataSchema} is one this version's author wrote.
   *
   * `false` for a version that declared none, which rests with no state
   * of its own rather than being expected to write an empty one.
   */
  readonly declaresState: boolean;

  readonly #executor: ArvoEventHandlerExecutor<
    TSelf,
    TServices,
    TDataSchema,
    TDependencies,
    TMechanismHooks
  >;

  readonly #depthValidator: ArvoEventDepthValidator;

  readonly #declaredMiddleware:
    | readonly ArvoEventHandlerMiddlewareEntry<
        VersionedArvoContract,
        TServices,
        z.$ZodObject,
        TDependencies,
        TMechanismHooks
      >[]
    | null;

  // What a message names this version by, so that a reader of a fault knows
  // which of their versions it is about without looking anything up.
  readonly #contractAtVersion: string;

  /** @param param - What this version is declared as. */
  constructor(
    param: ArvoEventHandlerVersionParam<
      TSelf,
      TServices,
      TDataSchema,
      TDependencies,
      TMechanismHooks
    >,
  ) {
    this.contracts = Object.freeze({
      self: param.contracts.self,
      services: Object.freeze({ ...param.contracts.services }),
    });
    this.options = param.options;
    this.dataSchema = param.state;
    this.declaresState = param.declaresState;
    this.#executor = param.execute;
    this.#declaredMiddleware = param.middleware;
    this.#contractAtVersion = `${param.contracts.self.type}@${param.contracts.self.version}`;
    this.#depthValidator = new ArvoEventDepthValidator({
      maxDepth: param.options.maxDepth,
      contractAtVersion: this.#contractAtVersion,
    });
    Object.freeze(this);
  }

  /** Which version of the contract this implements, and runs executions of. */
  get version(): ArvoSemanticVersion {
    return this.contracts.self.version;
  }

  /**
   * One execution of this version, from the event that caused it to what
   * is to be published and committed.
   *
   * Three ways out. `produced` says these events and this record go
   * together, to be committed as one or not at all. `discarded` says this
   * event had already been processed and there is nothing to do. A fault
   * is thrown, and says nothing was concluded: no event to publish and no
   * record to commit, only what it would take to give up.
   *
   * The work failing is not one of the three. An executor that cannot
   * finish returns through the first, carrying this contract's handler
   * error event for the caller and a record that rests at `error`.
   *
   * @param param - What this execution brings with it.
   * @throws {ArvoHandlerFault} Where any check refuses the execution, where
   * the time one attempt or the whole execution is allowed has run out, or
   * where the executor raised one of its own.
   */
  async execute(
    param: ArvoEventHandlerVersionExecuteParam<
      TSelf,
      TServices,
      TDataSchema,
      TDependencies,
      TMechanismHooks
    >,
  ): Promise<ArvoEventHandlerExecuteResponse> {
    const record = await this.#resolveRecord(param);
    describeExecution(param.telemetry, {
      state: record,
      entry: param.entry,
      attempt: param.attempt,
    });
    markStage(param.telemetry, 'record_resolved');

    const refusal = this.#refuseEntry(param, record);
    markStage(param.telemetry, 'entry_judged');

    if (refusal === 'seen') {
      markOutcome(param.telemetry, {
        outcome: 'discarded',
        self: this.contracts.self,
      });
      return {
        kind: 'discarded',
        reason: `${param.event.id} is already in this execution's trail as received, so it has been processed`,
      };
    }
    if (refusal !== null) {
      throw await this.#entryFaultFor(param, record, refusal);
    }

    const scope: ArvoDependencyScope = {
      event: param.event,
      // An event opening an execution read no record, and the one built
      // for it says nothing a supplier could not work out from the
      // event — so what it is handed is the absence that says which
      // kind of execution this is.
      state: param.state === null ? null : record,
      executionId: param.executionId,
      attempt: param.attempt,
      telemetry: param.telemetry,
    };

    const dependencies = await this.#openDependencies(param, record, scope);
    markStage(param.telemetry, 'dependencies_resolved');

    // From here to every exit the dependency is open, so every exit has
    // to close it — including a return validation refusal and a record
    // that would not serialize, both of which happen after the executor.
    try {
      return await this.#runWithDependencies(param, record, dependencies);
    } finally {
      await this.#closeDependencies(param, scope);
    }
  }

  /** Everything from the collection to the record, with dependencies open. */
  async #runWithDependencies(
    param: ArvoEventHandlerVersionExecuteParam<
      TSelf,
      TServices,
      TDataSchema,
      TDependencies,
      TMechanismHooks
    >,
    record: ArvoContextState<TSelf, TServices, TDataSchema>,
    dependencies: Partial<TDependencies> | null,
  ): Promise<ArvoEventHandlerExecuteResponse> {
    const collectedRecord =
      param.entry === 'followup'
        ? collectResponse(record, param.event)
        : record;

    // Every followup, whether or not the collection is complete. An
    // execution opening one has asked for nothing yet and has no
    // collection to measure; one still waiting has the collection that
    // matters most, and measuring only the completed ones would leave
    // every execution stuck on a wide collection out of the figure.
    if (param.entry === 'followup') {
      markCollection(
        param.telemetry,
        this.contracts.self,
        collectedRecord.inFlightEventMap.size,
      );
    }

    if (param.entry === 'followup' && !this.#isJoined(collectedRecord)) {
      markStage(param.telemetry, 'collection_partial', {
        awaiting: collectedRecord.inFlightEventMap.size,
      });
      return this.#produce(param, collectedRecord, []);
    }

    // Derived from the record rather than remembered on it: nothing is
    // stored, so carrying out the same events again gives the same keys.
    //
    // Derived here rather than by the context, which holds all three
    // parts and derives everything else of this sort itself: hashing is
    // async, and a context is constructed synchronously and frozen. The
    // member has to be a plain property to be worth having, so the one
    // await happens on the way in.
    const idempotency = await arvoIdempotencyKeysFor({
      subject: collectedRecord.subject,
      executionId: collectedRecord.executionId,
      deliveredEventId: collectedRecord.triggeringEvent.id,
    });

    // built before the context, so a refusal leaves nothing half-done
    const runClock = new AbortController();
    const middlewareAttempt = await tryCreateArvoComposedMiddleware<
      TSelf,
      TServices,
      TDataSchema,
      TDependencies,
      TMechanismHooks
    >({
      supplied: param.middleware,
      declared: this.#declaredMiddleware,
      abortSignal: runClock.signal,
    });
    if (!middlewareAttempt.ok) {
      throw await this.#faultFor(
        param,
        collectedRecord,
        refusalFrom(middlewareAttempt.error),
      );
    }

    const ctx = new ArvoExecutionContext<
      TSelf,
      TServices,
      TDataSchema,
      TDependencies,
      TMechanismHooks
    >({
      contracts: {
        self: this.contracts.self,
        services: this.contracts.services,
      },
      state: collectedRecord,
      dataSchema: this.dataSchema,
      entry: param.entry,
      attempt: param.attempt,
      telemetry: param.telemetry,
      options: this.options,
      idempotency,
      dependencies,
      hooks: param.hooks,
    });

    markStage(param.telemetry, 'executor_entered', {
      awaiting: collectedRecord.inFlightEventMap.size,
    });

    const { executorRun, executorTimings } = await this.#enterExecutor(
      ctx,
      middlewareAttempt.value,
      runClock,
    );
    const executorDurationMs =
      executorTimings.startedAt === null
        ? 0
        : (executorTimings.returnedAt ?? Date.now()) -
          executorTimings.startedAt;
    markExecutorRan(param.telemetry, this.contracts.self, executorDurationMs);
    if (middlewareAttempt.value.count.total > 0) {
      markMiddlewareRan(
        param.telemetry,
        this.contracts.self,
        Date.now() - ctx.enteredAt - executorDurationMs,
      );
    }
    markStage(param.telemetry, `executor_${executorRun.kind}`);

    if (executorRun.kind === 'outran') {
      throw await this.#faultFor(param, ctx.state, this.#refuseForTime(ctx));
    }
    if (executorRun.kind === 'raised') {
      if (executorRun.thrown instanceof ArvoHandlerFault) {
        if (this.#isOwnFault(executorRun.thrown, ctx)) throw executorRun.thrown;

        throw await this.#faultFor(param, ctx.state, {
          faultKind: 'executor_raised',
          message: `your executor for ${this.#contractAtVersion} raised a fault belonging to another execution (${executorRun.thrown.subject}), which nothing sound can do — a fault describes the execution it was built in, and acting on this one would end that execution for an event that is not its own`,
          violations: [],
          cause: executorRun.thrown.message,
          retryable: false,
        });
      }
      return this.#reportFailedWork(param, ctx.state, executorRun.thrown);
    }

    // read at the executor's return: after parts change neither verdict
    const recordAtExecutorReturn = executorTimings.recordAtReturn;
    await this.#refuseOnClocks(
      param,
      ctx,
      recordAtExecutorReturn,
      executorRun.returnedAt,
    );

    const batch = collectBatch(executorRun.emission);
    if (batch === null) {
      throw await this.#faultFor(param, recordAtExecutorReturn, {
        faultKind: 'emission_not_permitted',
        message: `your executor for ${this.#contractAtVersion} returned something that is not an event: it must return an ArvoEvent, an array of them, or nothing at all. Build events with ctx.build()`,
        violations: [],
      });
    }

    const batchRefusal = refuseBatch(
      this.contracts.self,
      this.contracts.services,
      this.options.maxDepth,
      batch,
    );
    if (batchRefusal !== null) {
      throw await this.#faultFor(param, recordAtExecutorReturn, batchRefusal);
    }
    markStage(param.telemetry, 'returns_judged', { emitted: batch.length });

    const silentCancelRefusal = this.#refuseSilentCancel(
      recordAtExecutorReturn,
      batch,
    );
    if (silentCancelRefusal !== null) {
      throw await this.#faultFor(
        param,
        recordAtExecutorReturn,
        silentCancelRefusal,
      );
    }

    return this.#produce(param, recordAtExecutorReturn, batch);
  }

  /** The record this execution runs against, built or restored. */
  async #resolveRecord(
    param: ArvoEventHandlerVersionExecuteParam<
      TSelf,
      TServices,
      TDataSchema,
      TDependencies,
      TMechanismHooks
    >,
  ): Promise<ArvoContextState<TSelf, TServices, TDataSchema>> {
    if (param.state === null) {
      const openingRecord = createInitArvoExecutionState<
        TSelf,
        TServices,
        TDataSchema
      >({
        self: this.contracts.self,
        event: param.event,
        executionId: param.executionId,
        parentExecutionId: param.event.executionid,
      });
      if (openingRecord.ok) return openingRecord.value;

      throw await this.#unreadableRecordFault(param, {
        faultKind: 'record_invalid',
        message: `this event could not open an execution of ${this.#contractAtVersion}, so nothing was stored or emitted: ${openingRecord.error.message}`,
        violations: [],
        cause: openingRecord.error.message,
      });
    }

    const restoredRecord = await createFollowupArvoExecutionState<
      TSelf,
      TServices,
      TDataSchema
    >({
      dataSchema: this.dataSchema,
      event: param.event,
      state: param.state,
      executionId: param.executionId,
    });

    if (!restoredRecord.ok) {
      throw await this.#refuseStoredRow(param, restoredRecord.error);
    }

    // A version that declared nothing to remember has a record carrying
    // none. Anything stored under it was written by something that is
    // not this version, and reading it would be reading state under a
    // schema that was never its own.
    if (!this.declaresState && restoredRecord.value.data !== null) {
      throw await this.#faultFor(param, restoredRecord.value, {
        faultKind: 'record_invalid',
        message: `this execution of ${this.#contractAtVersion} remembers nothing, so its record carries no state — and this one does. Declare a state schema for this version, or find what wrote it`,
        violations: [
          `data: must be null for a version declaring no state schema`,
        ],
      });
    }

    // A record belongs to one version for its whole life. Which executor
    // runs is settled before this, so reaching here under another is a
    // mistake one layer up — and one worth refusing rather than running,
    // because running it would remember this execution under a schema
    // that was never its own.
    if (restoredRecord.value.version !== this.contracts.self.version) {
      throw await this.#faultFor(param, restoredRecord.value, {
        faultKind: 'version_not_declared',
        message: `this execution belongs to ${this.contracts.self.type}@${restoredRecord.value.version} and was handed to the executor for ${this.#contractAtVersion}, which is not its own and will not resume it`,
        violations: [],
      });
    }

    // The record's own copies of what the init event says are checked
    // before anything compares the record with the event that arrived: a
    // record that contradicts itself is corrupt, and reads as corrupt.
    const disagreements = await disagreementsWithInitEvent(
      restoredRecord.value,
    );
    if (disagreements.length > 0) {
      throw await this.#faultFor(param, restoredRecord.value, {
        faultKind: 'record_invalid',
        message: `the stored state for this execution of ${this.#contractAtVersion} disagrees with the event that opened it, so it is corrupt and will not be resumed. The fields that disagree are listed`,
        violations: disagreements,
      });
    }

    return restoredRecord.value;
  }

  /**
   * Why a stored row is not a record this version can run against.
   *
   * Where only `data` was refused, the envelope held and the events
   * restored, so the record is trustworthy enough to address a caller from
   * and is read again under a schema that accepts anything to build the
   * pair. Where the envelope itself failed, nothing may be read off it at
   * all, and the fault carries neither half.
   */
  async #refuseStoredRow(
    param: ArvoEventHandlerVersionExecuteParam<
      TSelf,
      TServices,
      TDataSchema,
      TDependencies,
      TMechanismHooks
    >,
    error:
      | ArvoExecutionStateSerializerError
      | ArvoExecutionStateValidationError,
  ): Promise<ArvoHandlerFault> {
    const issues =
      error instanceof ArvoExecutionStateValidationError ? error.issues : [];

    const refusal: ArvoGateRefusal = {
      faultKind: issues.some((issue) =>
        /^(initEvent|triggeringEvent|inFlightEventMap)/.test(
          String(issue.path),
        ),
      )
        ? 'record_event_unrestorable'
        : 'record_invalid',
      message: `the stored state for this execution could not be read back under ${this.#contractAtVersion}: ${error.message}. A state schema changed in a way the records already stored do not satisfy does this`,
      violations: issues.map((issue) => issue.toString()),
      cause: error.message,
    };

    const dataAloneFailed =
      issues.length > 0 &&
      issues.every((issue) => String(issue.path).startsWith('data'));
    if (!dataAloneFailed || param.state === null) {
      return this.#unreadableRecordFault(param, refusal);
    }

    const addressableRecord = await createFollowupArvoExecutionState<
      TSelf,
      TServices,
      z.$ZodObject
    >({
      dataSchema: ARVO_ANY_STATE_SCHEMA,
      event: param.event,
      state: param.state,
      executionId: param.executionId,
    });

    return addressableRecord.ok
      ? this.#faultFor(param, addressableRecord.value, refusal)
      : this.#unreadableRecordFault(param, refusal);
  }

  /**
   * A fault about a record that could not be read, which therefore names
   * nothing read off one.
   *
   * An opening execution can still answer its caller — the event that
   * opened it says who that is — while an execution answering a service
   * holds only that service's response, whose every identifier names the
   * service rather than the caller.
   */
  async #unreadableRecordFault(
    param: ArvoEventHandlerVersionExecuteParam<
      TSelf,
      TServices,
      TDataSchema,
      TDependencies,
      TMechanismHooks
    >,
    refusal: ArvoGateRefusal,
  ): Promise<ArvoHandlerFault> {
    return createArvoHandlerFault({
      contracts: { self: this.contracts.self },
      state: null,
      event: param.event,
      initEvent: param.entry === 'init' ? param.event : null,
      executionId: param.executionId,
      options: this.options,
      attempt: param.attempt,
      telemetry: param.telemetry,
      faultKind: refusal.faultKind,
      message: refusal.message,
      violations: refusal.violations,
      cause: refusal.cause,
    });
  }

  /**
   * Why this execution may not proceed, `'seen'` where the event has
   * already been processed, or `null` where it may.
   *
   * In the order the protocol fixes: the event's depth, then what the
   * record says about itself, then what the record and the event say about
   * each other.
   */
  #refuseEntry(
    param: ArvoEventHandlerVersionExecuteParam<
      TSelf,
      TServices,
      TDataSchema,
      TDependencies,
      TMechanismHooks
    >,
    record: ArvoExecutionState,
  ): ArvoGateRefusal | 'seen' | null {
    const depthCheck = this.#depthValidator.validateInput(param.event);
    if (!depthCheck.ok) {
      return {
        faultKind: depthCheck.error.faultKind,
        message: depthCheck.error.message,
        violations: depthCheck.error.issues.map((issue) => issue.toString()),
      };
    }

    const isFollowup = param.entry === 'followup';
    if (isFollowup && alreadySeen(record, param.event)) return 'seen';

    const terminalRefusal = isFollowup ? refuseTerminal(record) : null;
    if (terminalRefusal !== null) return terminalRefusal;

    const outlivedRefusal = refuseOutlived(
      this.#contractAtVersion,
      record.initEvent,
      this.options.executionTimeout,
      Date.now(),
    );
    if (outlivedRefusal !== null) return outlivedRefusal;

    const misaddressedRefusal = refuseMisaddressed(
      this.contracts.self,
      param.event,
      isFollowup ? record : null,
    );
    if (misaddressedRefusal !== null) return misaddressedRefusal;

    // After the record has had its say and before the collection is read,
    // which is where the event's own type and payload belong.
    const unreceivableRefusal = param.checkEvent?.() ?? null;
    if (unreceivableRefusal !== null) return unreceivableRefusal;

    return isFollowup ? refuseUnawaited(record, param.event) : null;
  }

  /** What the executor is given to work with, by value or from a factory. */
  /**
   * Opens what the executor will be given, and reads it.
   *
   * Reading the surface is part of opening: a dependency that took
   * something and then could not hand it over did not become usable,
   * which is the same failure for the same reason.
   */
  async #openDependencies(
    param: ArvoEventHandlerVersionExecuteParam<
      TSelf,
      TServices,
      TDataSchema,
      TDependencies,
      TMechanismHooks
    >,
    record: ArvoExecutionState,
    scope: ArvoDependencyScope,
  ): Promise<Partial<TDependencies> | null> {
    const dependencies: IArvoEventHandlerDependency<TDependencies> | null =
      param.dependencies;
    if (dependencies === null) return null;

    try {
      await dependencies.open(scope);
      return dependencies.attributes;
    } catch (thrown) {
      throw await this.#entryFaultFor(param, record, {
        faultKind: 'dependency_resolution_failed',
        message: `the dependencies for ${this.#contractAtVersion} could not be opened, so your executor was never entered: ${thrown instanceof Error ? thrown.message : String(thrown)}. Another attempt may succeed`,
        violations: [],
        cause: thrown instanceof Error ? thrown.message : String(thrown),
      });
    }
  }

  /**
   * Lets go of what was opened, whatever happened in between.
   *
   * A failure here cannot change what the execution concluded, so it is
   * recorded and discarded. Turning a committed execution into a fault
   * because a connection would not close would retry business logic over
   * a cleanup problem.
   */
  async #closeDependencies(
    param: ArvoEventHandlerVersionExecuteParam<
      TSelf,
      TServices,
      TDataSchema,
      TDependencies,
      TMechanismHooks
    >,
    scope: ArvoDependencyScope,
  ): Promise<void> {
    if (param.dependencies === null) return;

    try {
      await param.dependencies.close(scope);
    } catch (thrown) {
      markSwallowed(param.telemetry, 'dependencies_not_closed', thrown);
    }
  }

  /**
   * Why an execution that ended itself may not leave, or `null` where it
   * may.
   *
   * Cancelling is a reason to stop, not a way out of the protocol: an
   * execution that marks itself cancelled and answers nobody would leave
   * its caller waiting forever, and requests to services without an
   * answer would leave it waiting for responses a cancelled execution has
   * no business processing. It is the missing answer that is refused, not
   * the compensation beside it.
   */
  #refuseSilentCancel(
    record: ArvoExecutionState,
    batch: readonly ArvoEvent[],
  ): ArvoGateRefusal | null {
    if (record.lifecycle !== 'cancelled') return null;

    const answersCaller = batch.some(
      (event) =>
        resolveEmissionTarget(
          this.contracts.self,
          this.contracts.services,
          event.type,
        )?.role === 'completion',
    );
    if (answersCaller) return null;

    return {
      faultKind: 'execution_cancelled',
      message: `your executor called ctx.cancel(${JSON.stringify(record.lifecycleDescription ?? '')}) but returned nothing that answers the caller, who would wait forever. Cancel and answer in the same return`,
      violations: [],
    };
  }

  /**
   * Whether a fault an executor raised is this execution's own.
   *
   * One built through this context describes this execution: the same
   * execution, answering the same event. Anything else came from
   * somewhere it could not have come from, and a mechanism acting on it
   * would end an execution that has nothing to do with this event.
   */
  #isOwnFault(
    fault: ArvoHandlerFault,
    ctx: ArvoExecutionContext<
      TSelf,
      TServices,
      TDataSchema,
      TDependencies,
      TMechanismHooks
    >,
  ): boolean {
    return (
      fault.executionId === ctx.state.executionId &&
      fault.eventId === ctx.state.triggeringEvent.id
    );
  }

  /** Whether every answer this execution is waiting for is in. */
  #isJoined(record: ArvoExecutionState): boolean {
    return this.options.collect === 'each' || record.isCollectionComplete;
  }

  /**
   * One entry into the executor, between the before and after parts of its
   * middleware, bounded by the run clock.
   *
   * The clock is raced rather than read afterwards, because a handler that
   * waited for a stuck executor would never report it and a mechanism
   * would never retry it. Where the clock wins, the run clock's signal is
   * aborted, so no middleware part starts after it, and nothing the
   * executor later returns or raises is accepted: the protocol does not
   * promise its work stopped, only that this execution no longer listens
   * to it. Where the clock wins during an after part, the executor's
   * return stands.
   */
  async #enterExecutor(
    ctx: ArvoExecutionContext<
      TSelf,
      TServices,
      TDataSchema,
      TDependencies,
      TMechanismHooks
    >,
    middleware: ArvoComposedMiddleware<
      TSelf,
      TServices,
      TDataSchema,
      TDependencies,
      TMechanismHooks
    >,
    runClock: AbortController,
  ): Promise<{
    executorRun: ArvoExecutorRun;
    executorTimings: {
      startedAt: number | null;
      returnedAt: number | null;
      emission: ArvoExecutorEmission;
      recordAtReturn: ArvoContextState<TSelf, TServices, TDataSchema>;
    };
  }> {
    // written by the run below as it goes, read when the race settles
    const executorTimings: {
      startedAt: number | null;
      returnedAt: number | null;
      emission: ArvoExecutorEmission;
      recordAtReturn: ArvoContextState<TSelf, TServices, TDataSchema>;
    } = {
      startedAt: null,
      returnedAt: null,
      emission: undefined,
      // the record as the executor left it: nothing an after part writes may reach it
      recordAtReturn: ctx.state,
    };

    const runWithMiddleware = async (): Promise<ArvoExecutorRun> => {
      let returnedAt: number;
      try {
        await middleware.before(ctx);
        // the clock has already won: this only spares entering the executor
        if (runClock.signal.aborted) return { kind: 'outran' };
        executorTimings.startedAt = Date.now();
        executorTimings.emission = await this.#executor(ctx);
        returnedAt = Date.now();
        executorTimings.returnedAt = returnedAt;
        executorTimings.recordAtReturn = ctx.state;
      } catch (thrown) {
        return { kind: 'raised', thrown };
      }
      await middleware.after(ctx, executorTimings.emission);
      if (
        ctx.state !== executorTimings.recordAtReturn &&
        !runClock.signal.aborted
      ) {
        markStage(ctx.telemetry, 'middleware_after_write_discarded');
      }
      return {
        kind: 'returned',
        emission: executorTimings.emission,
        returnedAt,
      };
    };

    const { runTimeout } = this.options;
    if (runTimeout === null) {
      return { executorRun: await runWithMiddleware(), executorTimings };
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    const clock = new Promise<ArvoExecutorRun>((settle) => {
      timer = setTimeout(() => {
        runClock.abort();
        settle({ kind: 'outran' });
      }, runTimeout);
    });

    try {
      const executorRun = await Promise.race([runWithMiddleware(), clock]);
      if (executorRun.kind !== 'outran')
        return { executorRun, executorTimings };
      // ran out in an after part: the executor's return stands
      if (executorTimings.returnedAt !== null) {
        markStage(ctx.telemetry, 'middleware_after_cut');
        return {
          executorRun: {
            kind: 'returned',
            emission: executorTimings.emission,
            returnedAt: executorTimings.returnedAt,
          },
          executorTimings,
        };
      }
      return { executorRun, executorTimings };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Why an execution that outran one attempt's clock is refused.
   *
   * The execution clock is read first: where the whole execution has also
   * passed its bound, that is the broader verdict and the one reported,
   * and it is not worth another attempt.
   */
  #refuseForTime(
    ctx: ArvoExecutionContext<
      TSelf,
      TServices,
      TDataSchema,
      TDependencies,
      TMechanismHooks
    >,
  ): ArvoGateRefusal {
    const outlivedRefusal = refuseOutlived(
      this.#contractAtVersion,
      ctx.state.initEvent,
      this.options.executionTimeout,
      Date.now(),
    );
    if (outlivedRefusal !== null) return outlivedRefusal;

    return {
      faultKind: 'run_timeout',
      message: `your executor for ${this.#contractAtVersion} had not returned after ${this.options.runTimeout}ms (runTimeout), so this attempt was abandoned. It may still be running; nothing it returns now is used`,
      violations: [],
    };
  }

  /**
   * Why an executor that returned in time may still not have.
   *
   * An executor that blocks rather than awaits holds the one thread the
   * run clock would have fired on, so the clock is read again here.
   */
  async #refuseOnClocks(
    param: ArvoEventHandlerVersionExecuteParam<
      TSelf,
      TServices,
      TDataSchema,
      TDependencies,
      TMechanismHooks
    >,
    ctx: ArvoExecutionContext<
      TSelf,
      TServices,
      TDataSchema,
      TDependencies,
      TMechanismHooks
    >,
    record: ArvoContextState<TSelf, TServices, TDataSchema>,
    returnedAt: number,
  ): Promise<void> {
    // The execution clock is read first so that where both have expired
    // the broader verdict is the one reported.
    const outlivedRefusal = refuseOutlived(
      this.#contractAtVersion,
      record.initEvent,
      this.options.executionTimeout,
      returnedAt,
    );
    if (outlivedRefusal !== null) {
      throw await this.#faultFor(param, record, outlivedRefusal);
    }

    const runDurationMs = returnedAt - ctx.enteredAt;
    if (
      this.options.runTimeout !== null &&
      runDurationMs >= this.options.runTimeout
    ) {
      throw await this.#faultFor(param, record, {
        faultKind: 'run_timeout',
        message: `your executor for ${this.#contractAtVersion} returned after ${runDurationMs}ms, past the ${this.options.runTimeout}ms it is allowed (runTimeout), so what it returned was discarded. Code that blocks rather than awaits cannot be stopped partway`,
        violations: [],
      });
    }
  }

  /**
   * What a caller is told where the executor could not finish the work.
   *
   * The work failing is not the execution failing: the caller is answered
   * with this contract's handler error event, and the execution ends at
   * `error` with a record to commit.
   */
  async #reportFailedWork(
    param: ArvoEventHandlerVersionExecuteParam<
      TSelf,
      TServices,
      TDataSchema,
      TDependencies,
      TMechanismHooks
    >,
    record: ArvoContextState<TSelf, TServices, TDataSchema>,
    thrown: unknown,
  ): Promise<ArvoEventHandlerExecuteResponse> {
    const message = thrown instanceof Error ? thrown.message : String(thrown);

    const handlerErrorEvent = buildHandlerErrorEvent(
      this.contracts.self,
      {
        source: record.source,
        subject: record.subject,
        depth: record.depth,
        parentExecutionId: record.parentExecutionId,
        initEvent: record.initEvent,
        event: record.triggeringEvent,
      },
      message,
      this.options.handlerErrorDomain,
    );

    if (handlerErrorEvent === null) {
      throw await this.#faultFor(param, record, {
        faultKind: 'executor_raised',
        message: `your executor for ${this.#contractAtVersion} failed (${message}), and the error event that would have told the caller could not be built. Nothing was emitted or stored`,
        violations: [],
        cause: message,
      });
    }

    const erroredRecord = mutateState(record, {
      lifecycle: 'error',
      lifecycleDescription: `this executor could not finish the work: ${message}`,
      eventIds: [
        ...record.eventIds,
        { id: handlerErrorEvent.id, direction: 'emitted' },
      ],
    });

    const recordWrite = await writeRecord(
      this.dataSchema,
      atNextRevision(erroredRecord, param.entry),
    );
    if (!recordWrite.ok)
      throw await this.#faultFor(param, erroredRecord, recordWrite.error);
    markStage(param.telemetry, 'record_written');

    param.telemetry.setSpanError(erroredRecord.lifecycleDescription as string);
    param.telemetry.logger.error(erroredRecord.lifecycleDescription as string);
    param.telemetry.metric.count('executions', {
      outcome: 'produced',
      lifecycle: 'error',
      'contract.type': this.contracts.self.type,
      'contract.version': this.contracts.self.version,
    });

    return {
      kind: 'produced',
      events: [handlerErrorEvent],
      state: recordWrite.value,
    };
  }

  /** The events to publish and the record to commit, as one answer. */
  async #produce(
    param: ArvoEventHandlerVersionExecuteParam<
      TSelf,
      TServices,
      TDataSchema,
      TDependencies,
      TMechanismHooks
    >,
    record: ArvoContextState<TSelf, TServices, TDataSchema>,
    batch: ArvoEvent[],
  ): Promise<ArvoEventHandlerExecuteResponse> {
    const settledRecord = settleRecord(
      this.contracts.self,
      this.contracts.services,
      record,
      batch,
    );

    const recordWrite = await recordToCommit(
      this.declaresState,
      this.dataSchema,
      atNextRevision(settledRecord, param.entry),
    );
    if (!recordWrite.ok)
      throw await this.#faultFor(param, settledRecord, recordWrite.error);
    markStage(param.telemetry, 'record_written');

    markOutcome(param.telemetry, {
      outcome: 'produced',
      self: this.contracts.self,
      emitted: batch.length,
      lifecycle: settledRecord.lifecycle,
    });

    return { kind: 'produced', events: batch, state: recordWrite.value };
  }

  /** One refusal as the fault it becomes, built for a caller to throw. */
  async #faultFor(
    param: ArvoEventHandlerVersionExecuteParam<
      TSelf,
      TServices,
      TDataSchema,
      TDependencies,
      TMechanismHooks
    >,
    record: ArvoExecutionState,
    refusal: ArvoGateRefusal,
  ): Promise<ArvoHandlerFault> {
    return createArvoHandlerFault({
      contracts: { self: this.contracts.self },
      state: record,
      entry: param.entry,
      options: this.options,
      attempt: param.attempt,
      telemetry: param.telemetry,
      faultKind: refusal.faultKind,
      message: refusal.message,
      violations: refusal.violations,
      cause: refusal.cause,
      retryable: refusal.retryable,
    });
  }

  /**
   * One refusal on the way in as the fault it becomes.
   *
   * An execution that was opening carries only the caller's answer: no
   * execution validly began, so there is no record to rest at `failure`,
   * and storing one would make this event undeliverable ever after — the
   * next attempt would find a record where opening requires none.
   */
  async #entryFaultFor(
    param: ArvoEventHandlerVersionExecuteParam<
      TSelf,
      TServices,
      TDataSchema,
      TDependencies,
      TMechanismHooks
    >,
    record: ArvoExecutionState,
    refusal: ArvoGateRefusal,
  ): Promise<ArvoHandlerFault> {
    if (param.entry === 'followup') {
      return this.#faultFor(param, record, refusal);
    }

    return createArvoHandlerFault({
      contracts: { self: this.contracts.self },
      state: null,
      event: param.event,
      initEvent: param.event,
      executionId: param.executionId,
      options: this.options,
      attempt: param.attempt,
      telemetry: param.telemetry,
      faultKind: refusal.faultKind,
      message: refusal.message,
      violations: refusal.violations,
      cause: refusal.cause,
    });
  }
}
