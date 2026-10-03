import type * as z from 'zod/v4/core';
import type { VersionedArvoContract } from '../../ArvoContract/versioned/index.js';
import type { ArvoEvent } from '../../ArvoEvent/index.js';
import type { ArvoSemanticVersion } from '../../semver/index.js';
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
  ArvoEventHandlerExecuteResponse,
  ArvoEventHandlerExecutor,
} from '../types/execute.js';
import type { ArvoEventHandlerOptions } from '../types/options.js';
import type { ArvoServiceMap } from '../types/services.js';
import type {
  ArvoDependencies,
  ArvoDependencyResolver,
  ArvoMechanismHooks,
} from '../types/supplied.js';
import { ArvoEventDepthValidator } from '../validators/depth/index.js';
import {
  alreadySeen,
  refuseMisaddressed,
  refuseOutlived,
  refuseTerminal,
  refuseUnawaited,
} from './gate.js';
import {
  collectBatch,
  recordToCommit,
  refuseBatch,
  settleRecord,
  writeRecord,
} from './returns.js';
import {
  describeExecution,
  markExecutorRan,
  markOutcome,
  markStage,
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

  readonly #executor: ArvoEventHandlerExecutor<
    TSelf,
    TServices,
    TDataSchema,
    TDependencies,
    TMechanismHooks
  >;

  readonly #depth: ArvoEventDepthValidator;

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
    this.#executor = param.execute;
    this.#contractAtVersion = `${param.contracts.self.type}@${param.contracts.self.version}`;
    this.#depth = new ArvoEventDepthValidator({
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

    const dependencies = await this.#resolveDependencies(param, record);
    markStage(param.telemetry, 'dependencies_resolved');

    const collected =
      param.entry === 'followup'
        ? collectResponse(record, param.event)
        : record;

    if (param.entry === 'followup' && !this.#isJoined(collected)) {
      markStage(param.telemetry, 'collection_partial', {
        awaiting: collected.inFlightEventMap.size,
      });
      return this.#produce(param, collected, []);
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
      state: collected,
      dataSchema: this.dataSchema,
      entry: param.entry,
      attempt: param.attempt,
      telemetry: param.telemetry,
      options: this.options,
      dependencies,
      hooks: param.hooks,
    });

    markStage(param.telemetry, 'executor_entered', {
      awaiting: collected.inFlightEventMap.size,
    });

    const entered = await this.#enterExecutor(ctx);
    markExecutorRan(
      param.telemetry,
      this.contracts.self,
      Date.now() - ctx.enteredAt,
    );
    markStage(param.telemetry, `executor_${entered.kind}`);

    if (entered.kind === 'outran') {
      throw await this.#faultFor(param, ctx.state, this.#refuseForTime(ctx));
    }
    if (entered.kind === 'raised') {
      if (entered.raised instanceof ArvoHandlerFault) throw entered.raised;
      return this.#reportFailedWork(param, ctx.state, entered.raised);
    }

    await this.#refuseOnClocks(param, ctx);

    const batch = collectBatch(entered.returned);
    if (batch === null) {
      throw await this.#faultFor(param, ctx.state, {
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
      throw await this.#faultFor(param, ctx.state, batchRefusal);
    }
    markStage(param.telemetry, 'returns_judged', { emitted: batch.length });

    const unanswered = this.#refuseSilentCancel(ctx.state, batch);
    if (unanswered !== null) {
      throw await this.#faultFor(param, ctx.state, unanswered);
    }

    return this.#produce(param, ctx.state, batch);
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
      const opened = createInitArvoExecutionState<
        TSelf,
        TServices,
        TDataSchema
      >({
        self: this.contracts.self,
        event: param.event,
        executionId: param.executionId,
        parentExecutionId: param.event.executionid,
      });
      if (opened.ok) return opened.value;

      throw await this.#unreadableRecordFault(param, {
        faultKind: 'record_invalid',
        message: `this event could not open an execution of ${this.#contractAtVersion}, so nothing was stored or emitted: ${opened.error.message}`,
        violations: [],
        cause: opened.error.message,
      });
    }

    const restored = await createFollowupArvoExecutionState<
      TSelf,
      TServices,
      TDataSchema
    >({
      dataSchema: this.dataSchema,
      event: param.event,
      state: param.state,
      executionId: param.executionId,
    });

    if (!restored.ok) {
      throw await this.#refuseStoredRow(param, restored.error);
    }

    // A record belongs to one version for its whole life. Which executor
    // runs is settled before this, so reaching here under another is a
    // mistake one layer up — and one worth refusing rather than running,
    // because running it would remember this execution under a schema
    // that was never its own.
    if (restored.value.version !== this.contracts.self.version) {
      throw await this.#faultFor(param, restored.value, {
        faultKind: 'version_not_declared',
        message: `this execution belongs to ${this.contracts.self.type}@${restored.value.version} and was handed to the executor for ${this.#contractAtVersion}, which is not its own and will not resume it`,
        violations: [],
      });
    }

    // The record's own copies of what the init event says are checked
    // before anything compares the record with the event that arrived: a
    // record that contradicts itself is corrupt, and reads as corrupt.
    const disagreements = await disagreementsWithInitEvent(restored.value);
    if (disagreements.length > 0) {
      throw await this.#faultFor(param, restored.value, {
        faultKind: 'record_invalid',
        message: `the stored state for this execution of ${this.#contractAtVersion} disagrees with the event that opened it, so it is corrupt and will not be resumed. The fields that disagree are listed`,
        violations: disagreements,
      });
    }

    return restored.value;
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
      issues.every((issue) => /^data/.test(String(issue.path)));
    if (!dataAloneFailed || param.state === null) {
      return this.#unreadableRecordFault(param, refusal);
    }

    const addressable = await createFollowupArvoExecutionState<
      TSelf,
      TServices,
      z.$ZodObject
    >({
      dataSchema: ARVO_ANY_STATE_SCHEMA,
      event: param.event,
      state: param.state,
      executionId: param.executionId,
    });

    return addressable.ok
      ? this.#faultFor(param, addressable.value, refusal)
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
    const depth = this.#depth.validateInput(param.event);
    if (!depth.ok) {
      return {
        faultKind: depth.error.faultKind,
        message: depth.error.message,
        violations: depth.error.issues.map((issue) => issue.toString()),
      };
    }

    const onFollowup = param.entry === 'followup';
    if (onFollowup && alreadySeen(record, param.event)) return 'seen';

    const terminal = onFollowup ? refuseTerminal(record) : null;
    if (terminal !== null) return terminal;

    const outlived = refuseOutlived(
      this.#contractAtVersion,
      record.initEvent,
      this.options.executionTimeout,
      Date.now(),
    );
    if (outlived !== null) return outlived;

    const misaddressed = refuseMisaddressed(
      this.contracts.self,
      param.event,
      onFollowup ? record : null,
    );
    if (misaddressed !== null) return misaddressed;

    return onFollowup ? refuseUnawaited(record, param.event) : null;
  }

  /** What the executor is given to work with, by value or from a factory. */
  async #resolveDependencies(
    param: ArvoEventHandlerVersionExecuteParam<
      TSelf,
      TServices,
      TDataSchema,
      TDependencies,
      TMechanismHooks
    >,
    record: ArvoExecutionState,
  ): Promise<TDependencies> {
    const resolver = param.dependencies as ArvoDependencyResolver<
      TDependencies,
      TDataSchema
    >;
    if (typeof resolver !== 'function') return resolver;

    try {
      return await resolver({
        event: param.event,
        state: record as ArvoExecutionState<TDataSchema>,
        attempt: param.attempt,
      });
    } catch (raised) {
      throw await this.#entryFaultFor(param, record, {
        faultKind: 'dependency_resolution_failed',
        message: `the dependencies for ${this.#contractAtVersion} could not be resolved, so your executor was never entered: ${raised instanceof Error ? raised.message : String(raised)}. Another attempt may succeed`,
        violations: [],
        cause: raised instanceof Error ? raised.message : String(raised),
      });
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

    const answered = batch.some(
      (event) =>
        resolveEmissionTarget(
          this.contracts.self,
          this.contracts.services,
          event.type,
        )?.role === 'completion',
    );
    if (answered) return null;

    return {
      faultKind: 'execution_cancelled',
      message: `your executor called ctx.cancel(${JSON.stringify(record.lifecycleDescription ?? '')}) but returned nothing that answers the caller, who would wait forever. Cancel and answer in the same return`,
      violations: [],
    };
  }

  /** Whether every answer this execution is waiting for is in. */
  #isJoined(record: ArvoExecutionState): boolean {
    return this.options.collect === 'each' || record.isCollectionComplete;
  }

  /**
   * One entry into the executor, bounded by the run clock.
   *
   * The clock is raced rather than read afterwards, because a handler that
   * waited for a stuck executor would never report it and a mechanism
   * would never retry it. Where the clock wins, nothing the executor later
   * returns or raises is accepted — the protocol does not promise its work
   * stopped, only that this execution no longer listens to it.
   */
  async #enterExecutor(
    ctx: ArvoExecutionContext<
      TSelf,
      TServices,
      TDataSchema,
      TDependencies,
      TMechanismHooks
    >,
  ): Promise<ArvoExecutorRun> {
    const running: Promise<ArvoExecutorRun> = (async () => {
      try {
        return { kind: 'returned', returned: await this.#executor(ctx) };
      } catch (raised) {
        return { kind: 'raised', raised };
      }
    })();

    if (this.options.runTimeout === null) return running;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const clock = new Promise<ArvoExecutorRun>((settle) => {
      timer = setTimeout(
        () => settle({ kind: 'outran' }),
        this.options.runTimeout as number,
      );
    });

    try {
      return await Promise.race([running, clock]);
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
    const outlived = refuseOutlived(
      this.#contractAtVersion,
      ctx.state.initEvent,
      this.options.executionTimeout,
      Date.now(),
    );
    if (outlived !== null) return outlived;

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
  ): Promise<void> {
    // The execution clock is read first so that where both have expired
    // the broader verdict is the one reported.
    const outlived = refuseOutlived(
      this.#contractAtVersion,
      ctx.state.initEvent,
      this.options.executionTimeout,
      Date.now(),
    );
    if (outlived !== null) {
      throw await this.#faultFor(param, ctx.state, outlived);
    }

    const ranFor = Date.now() - ctx.enteredAt;
    if (this.options.runTimeout !== null && ranFor >= this.options.runTimeout) {
      throw await this.#faultFor(param, ctx.state, {
        faultKind: 'run_timeout',
        message: `your executor for ${this.#contractAtVersion} returned after ${ranFor}ms, past the ${this.options.runTimeout}ms it is allowed (runTimeout), so what it returned was discarded. Code that blocks rather than awaits cannot be stopped partway`,
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
    raised: unknown,
  ): Promise<ArvoEventHandlerExecuteResponse> {
    const message = raised instanceof Error ? raised.message : String(raised);

    const answer = buildHandlerErrorEvent(
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

    if (answer === null) {
      throw await this.#faultFor(param, record, {
        faultKind: 'executor_raised',
        message: `your executor for ${this.#contractAtVersion} failed (${message}), and the error event that would have told the caller could not be built. Nothing was emitted or stored`,
        violations: [],
        cause: message,
      });
    }

    const errored = mutateState(record, {
      lifecycle: 'error',
      lifecycleDescription: `this executor could not finish the work: ${message}`,
      eventIds: [...record.eventIds, { id: answer.id, direction: 'emitted' }],
    });

    const written = await writeRecord(
      this.dataSchema,
      atNextRevision(errored, param.entry),
    );
    if (!written.ok) throw await this.#faultFor(param, errored, written.error);
    markStage(param.telemetry, 'record_written');

    param.telemetry.setSpanError(errored.lifecycleDescription as string);
    param.telemetry.logger.error(errored.lifecycleDescription as string);
    param.telemetry.metric.count('executions', {
      outcome: 'produced',
      lifecycle: 'error',
      'contract.type': this.contracts.self.type,
      'contract.version': this.contracts.self.version,
    });

    return { kind: 'produced', events: [answer], state: written.value };
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
    const settled = settleRecord(
      this.contracts.self,
      this.contracts.services,
      record,
      batch,
    );

    const written = await recordToCommit(
      this.dataSchema,
      atNextRevision(settled, param.entry),
    );
    if (!written.ok) throw await this.#faultFor(param, settled, written.error);
    markStage(param.telemetry, 'record_written');

    markOutcome(param.telemetry, {
      outcome: 'produced',
      self: this.contracts.self,
      emitted: batch.length,
      lifecycle: settled.lifecycle,
    });

    return { kind: 'produced', events: batch, state: written.value };
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
