import type { Meter, Tracer } from '@opentelemetry/api';
import type { ArvoContract } from '../../ArvoContract/index.js';
import type { ArvoLogger } from '../context/telemetry/types.js';
import type { ArvoEventHandlerOptions } from './options.js';
import type { ArvoServiceMap } from './services.js';
import type {
  ArvoDeclaredTypes,
  ArvoDependencies,
  ArvoMechanismHooks,
} from './supplied.js';

/**
 * Where a handler declaration begins: the contract it implements, what it
 * may send to, and how its versions behave unless one says otherwise.
 *
 * Every version the contract declares needs an executor before the
 * handler can be built, and each is added afterwards rather than here.
 *
 * @example
 * ```typescript
 * const param: ArvoEventHandlerSetupParam<typeof orderContract, typeof services> = {
 *   contracts: { self: orderContract, services },
 *   options: { maxRetryAttempts: 5 },
 * };
 * ```
 */
export type ArvoEventHandlerSetupParam<
  TSelf extends ArvoContract,
  TServices extends ArvoServiceMap,
  TDependencies extends ArvoDependencies,
  TMechanismHooks extends ArvoMechanismHooks,
> = {
  /** What this handler is bound to: what it implements, and what it may send to. */
  contracts: {
    /**
     * The contract this handler implements, whole rather than at one
     * version. Every version it declares needs an executor before `build`
     * accepts the handler.
     */
    self: TSelf;

    /**
     * The contracts this handler may send events to, each at one version,
     * under whatever local name you give it.
     *
     * The name is yours alone and nothing reads it: an emitted event's
     * destination comes from its type. One contract may appear only once,
     * whichever versions are involved, because a response names only its
     * own version and two declarations leave nothing to check it against.
     *
     * The implemented contract may be among them, which is how a handler
     * opens a child execution of itself.
     */
    services?: TServices;
  };

  /**
   * The options every version falls back to.
   *
   * Write only what should differ from what the protocol defines; the
   * rest are filled in. A version then declares only what should differ
   * from these.
   */
  options?: Partial<ArvoEventHandlerOptions>;

  /**
   * Where this handler's executions record: the tracer their spans are
   * started on, the meter their instruments are created on, and what
   * their log records are emitted through.
   *
   * Each is optional and each is a no-op where it is absent, so a
   * deployment with no OpenTelemetry SDK configured costs nothing and
   * changes no code.
   */
  telemetry?: {
    /** What each execution's span is started on. */
    tracer?: Tracer;
    /** What this handler's instruments are created on. */
    meter?: Meter | null;
    /** What log records are emitted through. */
    logger?: ArvoLogger | null;
  };

  /**
   * The types a mechanism will supply per execution: what an executor
   * finds on `ctx.dependencies` and on `ctx.hooks`.
   *
   * Read by nothing and stored by nothing. Neither is part of a
   * declaration, so there is no value to infer their types from, and
   * naming them here is what makes them anything but `any`.
   */
  types?: ArvoDeclaredTypes<TDependencies, TMechanismHooks>;
};
