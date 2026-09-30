import * as z from 'zod/v4/core';
import type { VersionedArvoContract } from '../../ArvoContract/versioned/index.js';
import { ArvoHandlerFault } from '../fault/index.js';
import type { ArvoInitEvent, ArvoServiceMap } from '../types/services.js';
import type {
  ArvoDependencies,
  ArvoMechanismHooks,
} from '../types/supplied.js';
import type {
  ArvoDeliveredEvent,
  ArvoEntryKind,
  ArvoExecutionContextParam,
  ArvoStateWrite,
} from './types.js';

/**
 * Everything an executor can know and do, built fresh for one delivery.
 *
 * Built from what the delivery knows, handed to an executor, and read back
 * afterwards for whatever was written. One kept past that point describes a
 * delivery already over.
 *
 * Its state is always valid against the schema governing it, because every
 * write is checked as it happens.
 *
 * @example
 * const orderState = z.object({ orderId: z.string(), attempts: z.number() });
 *
 * const ctx = new ArvoExecutionContext({
 *   contracts: {
 *     self: orderContract.versions['1.0.0'],
 *     services: { payments: paymentContract.versions['1.0.0'] },
 *   },
 *   state: { schema: orderState, value: null },
 *   entry: 'init',
 *   event: incoming,
 *   initEvent: incoming,
 *   attempt: 0,
 *   dependencies: { db },
 *   hooks: {},
 * });
 *
 * ctx.event.data.items;   // the init event's payload, with nothing to narrow
 * ctx.state;              // null, this execution has written nothing
 *
 * ctx.setState({ orderId: 'o-1', attempts: 1 });
 * ctx.setState((current) => ({ ...current, attempts: current.attempts + 1 }));
 * ctx.state.attempts;     // 2
 */
export class ArvoExecutionContext<
  TSelf extends VersionedArvoContract = VersionedArvoContract,
  TServices extends ArvoServiceMap = ArvoServiceMap,
  TStateSchema extends z.$ZodObject = z.$ZodObject,
  TArvoEntryKind extends ArvoEntryKind = ArvoEntryKind,
  TDependencies extends ArvoDependencies = ArvoDependencies,
  TMechanismHooks extends ArvoMechanismHooks = ArvoMechanismHooks,
> {
  /** This version of the contract implemented, and what it may send to. */
  readonly contracts: {
    readonly self: TSelf;
    readonly services: Readonly<TServices>;
  };

  /** Whether this delivery opened the execution or answers something it awaited. */
  readonly entry: TArvoEntryKind;

  /**
   * What this delivery carries, which follows from how it was classified:
   * the event this version takes in, or whatever a declared service
   * answered with, its handler error included.
   *
   * Where a service may answer several ways, narrow on `event.type`. No two
   * of them can share a type, so the one you name is the one you get.
   */
  readonly event: ArvoDeliveredEvent<TSelf, TServices, TArvoEntryKind>;

  /** The event that opened this execution. The delivered event, on an init. */
  readonly initEvent: ArvoInitEvent<TSelf>;

  /** Which attempt this delivery is, counting from 0. */
  readonly attempt: number;

  /**
   * The schema every write to this execution's state is checked against.
   *
   * Always present. A version that declared none is given one accepting any
   * JSON object, so nothing has to ask whether there is a schema before
   * checking a value against it.
   */
  readonly stateSchema: TStateSchema;

  /** What this delivery was given to work with, or empty where none was declared. */
  readonly dependencies: TDependencies;

  /** What the mechanism running this handler exposed, or empty where it exposed none. */
  readonly hooks: TMechanismHooks;

  /**
   * Held privately rather than as a property, so freezing the context stops
   * every other member being replaced without also stopping a write.
   */
  #state: z.output<TStateSchema> | null;

  constructor(
    param: ArvoExecutionContextParam<
      TSelf,
      TServices,
      TStateSchema,
      TArvoEntryKind,
      TDependencies,
      TMechanismHooks
    >,
  ) {
    this.contracts = Object.freeze({
      self: param.contracts.self,
      services: Object.freeze({ ...param.contracts.services }),
    });
    this.entry = param.entry;
    this.event = param.event;
    this.initEvent = param.initEvent;
    this.attempt = param.attempt;
    this.stateSchema = param.state.schema;
    this.dependencies = param.dependencies;
    this.hooks = param.hooks;
    this.#state = param.state.value;
    Object.freeze(this);
  }

  /**
   * What this execution has remembered, or `null` where it has written
   * nothing.
   *
   * Always what the schema produced, so a value it defaults or transforms
   * reads back as the schema left it rather than as it was written.
   */
  get state(): z.output<TStateSchema> | null {
    return this.#state;
  }

  /**
   * Replaces this execution's state whole, checking it as it is written.
   *
   * Pass a value, or a function receiving what is stored now — `null` on
   * the first write — and returning what replaces it. There is no partial
   * write and no merge: either way, what you give back is the whole of the
   * new state.
   *
   * Throws {@link ArvoHandlerFault} where the schema rejects the value,
   * raised at the line that wrote it rather than surfacing later with
   * nothing to point at.
   */
  setState(value: ArvoStateWrite<TStateSchema>): void {
    const next =
      typeof value === 'function'
        ? (value as (current: z.output<TStateSchema> | null) => unknown)(
            this.#state,
          )
        : value;

    const checked = z.safeParse(this.stateSchema, next);
    if (!checked.success) {
      throw new ArvoHandlerFault({
        faultKind: 'state_schema_rejected',
        message: `state does not satisfy the schema this version declared for it: ${checked.error.issues
          .map(
            (issue) => `${issue.path.join('.') || '(root)'} ${issue.message}`,
          )
          .join('; ')}`,
        violations: checked.error.issues.map(
          (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
        ),
        cause: null,
        subject: this.event.subject,
        executionId: this.event.executionid,
        eventId: this.event.id,
        attempt: this.attempt,
        timestamp: Date.now(),
        retry: null,
        abandonmentEvent: null,
        abandonmentState: null,
      });
    }
    this.#state = checked.data;
  }
}
