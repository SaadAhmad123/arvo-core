import * as z from 'zod/v4/core';
import type { VersionedArvoContract } from '../../ArvoContract/versioned/index.js';
import type { ArvoEvent } from '../../ArvoEvent/index.js';
import { tryBuildEmittedEvent } from '../emission/index.js';
import type {
  ArvoEmissionParam,
  ArvoEmittedEvent,
  ArvoUnsafeEmissionFields,
} from '../emission/types.js';
import { createArvoHandlerFault } from '../fault/factory.js';
import type { ArvoHandlerFault } from '../fault/index.js';
import type { ArvoFaultKind } from '../fault/types.js';
import { ArvoExecutionStateSerializer } from '../state/serializer/index.js';
import type { ArvoTouchedEventDirection } from '../state/types.js';
import { mutateState } from '../state/utils.js';
import type { ArvoEventHandlerOptions } from '../types/options.js';
import type { ArvoServiceMap } from '../types/services.js';
import type {
  ArvoDependencies,
  ArvoMechanismHooks,
} from '../types/supplied.js';
import type { ArvoExecutionContextTelemetry } from './telemetry/index.js';
import type {
  ArvoContextState,
  ArvoDataWrite,
  ArvoEntryKind,
  ArvoExecutionContextParam,
} from './types.js';

/**
 * Everything an executor can know and do, for one execution.
 *
 * What the execution knows — the event that caused it, the event that opened it,
 * where it rests, what it is waiting on — is read through {@link state}.
 * The context itself carries only what the record does not.
 *
 * Valid for the execution it was built for. One kept past that describes a
 * execution already over.
 *
 * Built by the version running the execution, from a record that has
 * already passed every check, and handed to an executor as its only
 * argument. Never constructed by hand.
 *
 * @example
 * ```typescript
 * declare const ctx: ArvoExecutionContext;
 *
 * ctx.state.triggeringEvent.type;  // what caused this execution
 * ctx.state.initEvent.data.items;  // what opened the execution
 * ctx.entry;                       // 'init' | 'followup'
 *
 * await ctx.setState({ data: { orderId: 'o-1', attempts: 1 } });
 * await ctx.setState({ data: (now) => ({ ...now, attempts: now.attempts + 1 }) });
 * ctx.state.data.attempts;         // 2
 * ```
 */
export class ArvoExecutionContext<
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

  /** Whether this execution opened the execution or answers something it awaited. */
  readonly entry: ArvoEntryKind;

  /** Which attempt this execution is, counting from 0. */
  readonly attempt: number;

  /** The options in force for this version, every one of them settled. */
  readonly options: ArvoEventHandlerOptions;

  /** The schema every write to this execution's data is checked against. */
  readonly dataSchema: TDataSchema;

  /** What this execution was given to work with, or empty where none was declared. */
  readonly dependencies: TDependencies;

  /** What the mechanism running this handler exposed, or empty where it exposed none. */
  readonly hooks: TMechanismHooks;

  /** This execution's telemetry object */
  readonly telemetry: ArvoExecutionContextTelemetry;

  /**
   * Whether one more step would reach the depth this version allows.
   *
   * Emitting to a service once it is true is refused, so read it before
   * deciding what to return.
   */
  readonly atMaxDepth: boolean;

  /**
   * When the executor was entered, as ms since the Unix epoch. Where the
   * run clock starts, and what {@link timeRemaining} counts from.
   */
  readonly enteredAt: number;

  // Private, not a property: freezing the context must stop every other
  // member being replaced without also stopping a write.
  #state: ArvoContextState<TSelf, TServices, TDataSchema>;

  constructor(
    param: ArvoExecutionContextParam<
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
    this.entry = param.entry;
    this.attempt = param.attempt;
    this.options = param.options;
    this.dataSchema = param.dataSchema;
    this.dependencies = param.dependencies;
    this.hooks = param.hooks;
    this.telemetry = param.telemetry;
    this.#state = param.state;
    this.atMaxDepth = param.state.depth + 1 >= param.options.maxDepth;
    this.enteredAt = Date.now();
    Object.freeze(this);
  }

  /**
   * Everything this execution remembers about itself, as it stands now.
   *
   * A different record after every write, the one before left untouched, so
   * a reference held across a write still reads what it read.
   */
  get state(): ArvoContextState<TSelf, TServices, TDataSchema> {
    return this.#state;
  }

  /**
   * Replaces this execution's data whole. No partial write, no merge.
   *
   * Nothing else about the execution moves, and what is remembered is what
   * the schema produced rather than what was written.
   *
   * @param param.data - The whole of the new data, or a function given
   * what is remembered now, which is `null` on the first write.
   * @throws {ArvoHandlerFault} `state_schema_rejected` where the schema
   * refuses the value. What is remembered is left as it was.
   */
  async setState(param: { data: ArvoDataWrite<TDataSchema> }): Promise<void> {
    const next =
      typeof param.data === 'function'
        ? (param.data as (current: z.output<TDataSchema> | null) => unknown)(
            this.#state.data,
          )
        : param.data;

    const checked = z.safeParse(this.dataSchema, next);
    if (!checked.success) {
      const at = (issue: { path: PropertyKey[]; message: string }) =>
        `${issue.path.join('.') || '(root)'}`;
      const violations = checked.error.issues.map(
        (issue) => `${at(issue)}: ${issue.message}`,
      );
      const reason = `state does not satisfy the schema this version declared for it: ${checked.error.issues
        .map((issue) => `${at(issue)} ${issue.message}`)
        .join('; ')}`;
      throw await this.fault({
        faultKind: 'state_schema_rejected',
        message: reason,
        violations,
      });
    }
    this.#state = mutateState(this.#state, { data: checked.data });
  }

  /**
   * What this execution finished as, written out for whatever stores it.
   *
   * The revision is advanced here and nowhere else. Data must not be
   * empty: an execution remembering nothing in particular writes `{}`.
   * Reads the context rather than changing it.
   *
   * @throws {ArvoHandlerFault} `state_schema_rejected` where data is empty,
   * `state_not_serializable` where the record holds something that cannot
   * be turned into JSON. Both carry the pair a mechanism would abandon
   * this execution with.
   *
   * @example
   * ```typescript
   * await ctx.setState({ data: { orderId: 'o-1' } });
   * await store.put(ctx.state.subject, await ctx.exportFinalState());
   * ```
   */
  async exportFinalState(): Promise<string> {
    if (this.#state.data === null) {
      throw await this.fault({
        faultKind: 'state_schema_rejected',
        message:
          'this execution finished having remembered nothing, and a record is only written for one that did something',
      });
    }

    const written = await new ArvoExecutionStateSerializer(
      this.dataSchema,
    ).trySerialize(
      mutateState(this.#state, { casVersion: this.#state.casVersion + 1 }),
    );
    if (written.ok) return written.value;

    throw await this.fault({
      faultKind: 'state_not_serializable',
      message:
        'this execution finished holding something that cannot be written out',
      cause: written.error.message,
    });
  }

  /**
   * Milliseconds left on each of the version's two clocks: `run` for this
   * attempt, `execution` from the event that opened it. `null` for a clock
   * left unbounded, negative once one is overrun. Worked out per read.
   *
   * @example
   * ```typescript
   * while (ctx.timeRemaining.run !== null && ctx.timeRemaining.run > 1_000) {
   *   await pollOnce();
   * }
   * ```
   */
  get timeRemaining(): {
    readonly run: number | null;
    readonly execution: number | null;
  } {
    const now = Date.now();
    return {
      run:
        this.options.runTimeout === null
          ? null
          : this.options.runTimeout - (now - this.enteredAt),
      execution:
        this.options.executionTimeout === null
          ? null
          : this.options.executionTimeout -
            (now - Date.parse(this.#state.initEvent.time)),
    };
  }

  /**
   * Records a service's response against the request it answers.
   *
   * The request is the one the response names, which is the `id` of the
   * event this execution emitted. Nothing else about the execution moves,
   * and the response joins the events it has handled.
   *
   * @param event - The response to take in.
   * @throws {ArvoHandlerFault} `response_unawaited` where the response
   * names no request, names one this execution never awaited, or names one
   * already answered. What is remembered is left as it was.
   *
   * @example
   * ```typescript
   * await ctx.collect(response);
   * ctx.state.inFlightEventMap.get(request.id); // the response
   * ```
   */
  async collect(event: ArvoEvent): Promise<void> {
    const awaited = event.initid;
    const held =
      awaited === null ? undefined : this.#state.inFlightEventMap.get(awaited);

    if (awaited === null || held === undefined || held !== null) {
      throw await this.fault({
        faultKind: 'response_unawaited',
        message: `this execution is not waiting for ${
          awaited === null
            ? 'a response naming no request'
            : held === undefined
              ? `a response to ${awaited}, which it never awaited`
              : `a second response to ${awaited}, which is already answered`
        }`,
      });
    }

    const awaiting = new Map(this.#state.inFlightEventMap);
    awaiting.set(awaited, event);
    this.#state = mutateState(this.#state, { inFlightEventMap: awaiting });
    this.markEventReceived(event);
  }

  /**
   * Adds an event to those this execution has handled, as received.
   *
   * The trail an execution leaves, not telemetry. Nothing else moves.
   *
   * @param event - The event the execution took in.
   */
  markEventReceived(event: ArvoEvent): void {
    this.#markEvent(event, 'received');
  }

  /**
   * Adds an event to those this execution has handled, as emitted.
   *
   * @param event - The event the execution sent.
   */
  markEventEmitted(event: ArvoEvent): void {
    this.#markEvent(event, 'emitted');
  }

  /**
   * One event appended to the log, whichever way it went, and only once.
   *
   * An event already logged is left alone. An event `id` is unique across
   * the ecosystem, so a second appearance is the same event, and a log
   * holding it twice would claim the execution handled two.
   */
  #markEvent(event: ArvoEvent, direction: ArvoTouchedEventDirection): void {
    if (this.#state.eventIds.some((logged) => logged.id === event.id)) return;
    this.#state = mutateState(this.#state, {
      eventIds: [...this.#state.eventIds, { id: event.id, direction }],
    });
  }

  /**
   * Ends this execution deliberately, at rest and with a reason.
   *
   * Nothing else about the execution moves. The reason is what a caller
   * and an operator read afterwards.
   *
   * @param reason - Why the execution was ended.
   *
   * @example
   * ```typescript
   * if (order.withdrawn) return ctx.cancel('the customer withdrew the order');
   * ```
   */
  cancel(reason: string): void {
    this.#state = mutateState(this.#state, {
      lifecycle: 'cancelled',
      lifecycleDescription: reason,
    });
  }

  /**
   * A fully addressed event, from a type and a payload.
   *
   * The type decides where it goes: one of this version's outputs completes
   * the execution, a declared service's input opens one there. Every other
   * field the protocol fixes is set for you.
   *
   * @param param.type - A declared service's input type, or one of this
   * version's outputs. The handler error type is refused: producing one is
   * the handler's, never an executor's.
   * @param param.data - The payload, checked against the schema `type`
   * selects.
   * @param param.domain - Which processing path fulfils this event. Omit
   * for none.
   * @param param.executionunits - What this event cost.
   * @param param.unsafe - Fields whose wrong value spoils something beyond
   * this execution. See {@link ArvoUnsafeEmissionFields}.
   * @throws {ArvoHandlerFault} `emission_not_permitted` for a type this
   * version may not emit, `emission_schema_rejected` for a payload the
   * schema refuses. Neither is worth another attempt.
   *
   * @example
   * ```typescript
   * const charge = await ctx.build({
   *   type: 'com_payment_charge',
   *   data: { amount: 4200 },
   * });
   * return [charge];
   * ```
   */
  async build<TParam extends ArvoEmissionParam<TSelf, TServices>>(
    param: TParam,
  ): Promise<ArvoEmittedEvent<TSelf, TServices, TParam['type']>> {
    const built = tryBuildEmittedEvent(
      {
        self: this.contracts.self,
        services: this.contracts.services,
        state: this.#state,
        telemetry: this.telemetry,
      },
      param,
    );
    if (built.ok) return built.value;
    throw await this.fault({
      faultKind: built.error.faultKind,
      message: built.error.message,
      violations: built.error.violations,
    });
  }

  /**
   * A fault about this execution, ready to throw.
   *
   * Built, not thrown. The execution is filled in from the record, so say
   * only what went wrong. The pair a mechanism would abandon this
   * execution with is built with it, and neither half is acted on here.
   *
   * Recorded on the execution span as it is built. A fault writes no
   * record, so the trace may be the only place a retried-away failure is
   * ever visible.
   *
   * @param param.faultKind - Which fault this is. Read by a mechanism to
   * decide what to do, so it comes from the fixed vocabulary.
   * @param param.message - What failed, the value involved, and the rule
   * broken, readable without this source at hand.
   * @param param.cause - The underlying failure as a string. Omit where
   * nothing underlies it.
   * @param param.violations - Every check that failed. Omit where none was
   * collected.
   * @param param.retryable - Whether another attempt could fix this.
   * Consulted for `executor_raised` alone, where the vocabulary leaves the
   * verdict to you and the answer is yes unless you say otherwise. Every
   * other kind carries the verdict its own vocabulary fixes.
   *
   * @example
   * ```typescript
   * if (!charge.ok) {
   *   throw await ctx.fault({
   *     faultKind: 'executor_raised',
   *     message: 'the payment gateway refused the charge',
   *     cause: charge.error.message,
   *   });
   * }
   * ```
   */
  async fault(param: {
    faultKind: ArvoFaultKind;
    message: string;
    cause?: string;
    violations?: readonly string[];
    retryable?: boolean;
  }): Promise<ArvoHandlerFault> {
    return createArvoHandlerFault({
      contracts: { self: this.contracts.self },
      state: this.#state,
      options: this.options,
      attempt: this.attempt,
      telemetry: this.telemetry,
      ...param,
    });
  }
}
