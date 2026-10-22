import { err, ok } from 'neverthrow';
import type { ArvoEvent } from '../ArvoEvent/index.js';
import { continueTraceFromEvent } from '../ArvoEvent/opentelemetry.js';
import { ArvoExecutionContextTelemetry } from '../ArvoEventHandler/context/telemetry/index.js';
import { recording } from '../ArvoEventHandler/context/telemetry/recording.js';
import {
  type ArvoResolvedTelemetry,
  resolveTelemetry,
} from '../ArvoEventHandler/context/telemetry/resolve.js';
import { createArvoHandlerFault } from '../ArvoEventHandler/fault/factory.js';
import type { ArvoHandlerFault } from '../ArvoEventHandler/fault/index.js';
import type { IArvoEventHandlerDependency } from '../ArvoEventHandler/types/dependency.js';
import type { ArvoEventHandlerExecuteResponse } from '../ArvoEventHandler/types/execute.js';
import type { ArvoEventHandlerMiddlewareEntry } from '../ArvoEventHandler/types/middleware.js';
import { mutateArvoEvent } from '../factories/mutateArvoEvent.js';
import { fromNeverthrow } from '../result.js';
import type { AsyncResult, Result } from '../types.js';
import { ErrorIssue } from '../utils/error-issue.js';
import { textOfThrown } from '../utils/thrown-text.js';
import { ArvoDispatcherValidationError } from './errors.js';
import { checkCallerName } from './helpers/check-caller-name.js';
import { checkEmpty } from './helpers/check-empty.js';
import { checkRepeatedHandlers } from './helpers/check-repeated-handlers.js';
import { checkServiceVersions } from './helpers/check-service-versions.js';
import { checkSharedTypes } from './helpers/check-shared-types.js';
import {
  type ArvoFlattenedMembers,
  flattenMembers,
} from './helpers/flatten.js';
import { longestRunTimeoutMs } from './helpers/longest-run-timeout.js';
import type {
  ArvoDispatcherExecuteParam,
  ArvoDispatcherMember,
  ArvoDispatcherOptions,
  ArvoDispatcherSet,
} from './types.js';
import type { ArvoAnyEventHandler, HandlersOf } from './typing.js';

/** The name of the one span a dispatcher opens per call. */
const ARVO_DISPATCHER_SPAN_NAME = 'arvo.dispatcher.execute';

/** Every handler a list of members holds, as the entry parameter reads them. */
type ArvoHandlersOfMembers<TMembers> = Extract<
  HandlersOf<TMembers>,
  readonly ArvoAnyEventHandler[]
>;

/** Whether a value is a dispatcher, and so a set whose lists are taken. */
const isDispatcher = (candidate: unknown): candidate is ArvoDispatcherSet =>
  candidate instanceof ArvoDispatcher;

/**
 * A set of handlers, entered as one handler.
 *
 * Picks the handler whose self contract `type` is the event's `to`, enters it
 * with what it was given and the set's layers, and returns what the handler
 * returned. It holds nothing between calls, and writes, routes, retries and
 * abandons nothing: each is what runs it.
 *
 * Construct it with {@link createArvoDispatcher}, or with `new` and the same
 * options. Declaration is refused, every rule broken named at once, where the
 * set is empty, one handler appears twice, two handlers share a self contract
 * `type`, or one handler declares a service another here implements at a
 * version or `uri` the implementer does not declare.
 *
 * @example
 * const dispatcher = new ArvoDispatcher({
 *   handlers: [orderHandler, paymentHandler],
 * });
 * dispatcher.handles('com_order_create'); // true
 */
export class ArvoDispatcher<
  const TMembers extends
    readonly ArvoDispatcherMember[] = readonly ArvoDispatcherMember[],
> {
  /** The handler list exactly as declared, nested dispatchers included. */
  readonly members: TMembers;

  /** Every handler in the set, flattened, in declaration order. */
  readonly handlers: readonly ArvoAnyEventHandler[];

  /** The layers supplied to every handler on every call, flattened, in order. */
  readonly middlewares: readonly ArvoEventHandlerMiddlewareEntry[];

  /** Where the dispatcher's own span, counter and log are written. */
  readonly telemetry: ArvoResolvedTelemetry;

  readonly #handlersByType: ReadonlyMap<string, ArvoAnyEventHandler>;

  readonly #longestRunTimeoutMs: number | null;

  /**
   * @param options - The handlers, the layers and the telemetry. See
   * {@link ArvoDispatcherOptions} for the rules a declaration is held to.
   * @throws {ArvoDispatcherValidationError} If the declaration breaks any
   * rule, naming every rule it broke.
   */
  constructor(options: ArvoDispatcherOptions<TMembers>) {
    const flattened = this.#validate(options);

    this.members = options.handlers;
    this.handlers = Object.freeze([...flattened.handlers]);
    this.middlewares = Object.freeze([...flattened.middlewares]);
    this.telemetry = resolveTelemetry(options.telemetry);
    this.#handlersByType = new Map(
      flattened.handlers.map((handler) => [
        handler.contracts.self.type,
        handler,
      ]),
    );
    this.#longestRunTimeoutMs = longestRunTimeoutMs(flattened.handlers);
  }

  /**
   * The declaration, flattened, or every rule it breaks thrown at once.
   *
   * The lists must be lists before anything inside them can be read; an
   * empty set blocks the rules that compare handlers.
   */
  #validate(options: ArvoDispatcherOptions<TMembers>): ArvoFlattenedMembers {
    const declared: { handlers: unknown; middlewares: unknown } = {
      handlers: options?.handlers,
      middlewares: options?.middlewares ?? [],
    };
    const shapeIssues: ErrorIssue[] = [];
    if (!Array.isArray(declared.handlers)) {
      shapeIssues.push(
        new ErrorIssue({
          path: 'handlers',
          message: 'must be a list of handlers or dispatchers',
          received: declared.handlers,
          blockingReason: 'there is no set to check without a list',
        }),
      );
    }
    if (!Array.isArray(declared.middlewares)) {
      shapeIssues.push(
        new ErrorIssue({
          path: 'middlewares',
          message: 'must be a list of layers or dispatchers, or omitted',
          received: declared.middlewares,
        }),
      );
    }
    if (shapeIssues.length > 0) {
      throw new ArvoDispatcherValidationError(shapeIssues);
    }

    const flattened = flattenMembers(
      { handlers: options.handlers, middlewares: options.middlewares ?? [] },
      isDispatcher,
    );
    const emptyIssues = checkEmpty(flattened.handlers);
    const issues = [
      ...flattened.issues,
      ...emptyIssues,
      ...(emptyIssues.length > 0
        ? []
        : [
            ...checkRepeatedHandlers(flattened.handlers),
            ...checkSharedTypes(flattened.handlers),
            ...checkServiceVersions(flattened.handlers),
          ]),
    ];
    if (issues.length > 0) {
      throw new ArvoDispatcherValidationError(issues);
    }
    return flattened;
  }

  /**
   * Enters the handler the event's `to` names, reporting a fault rather than
   * throwing.
   *
   * Takes exactly what a handler takes, less layers: `dependencies` holds one
   * entry per handler, keyed by its self contract `type`, and the picked
   * handler is given its own or none; `hooks` is one value every handler can
   * accept. Returns what the handler returned, unchanged.
   *
   * Where no handler in the set implements `to`, or the event carries none,
   * the fault is `handler_not_found`: not retryable, and carrying nothing to
   * abandon with. Anything thrown that is not a fault propagates as thrown.
   *
   * Opens one span per call, continuing the event's trace, and enters the
   * handler with a copy of the event naming that span where it is recording,
   * or the event itself where it is not. The event given is not modified.
   * The span is marked successful once a handler has been entered and has
   * returned, whatever it returned, and failed where no handler takes the
   * event or something that is not a fault is thrown, which is recorded on
   * the span and then propagates as thrown.
   *
   * @param param - The event, the state function, the attempt, and the
   * dependencies and hooks for the set.
   *
   * @example
   * const executed = await dispatcher.tryExecute({ event, state, attempt: 0 });
   * if (executed.ok) executed.value.kind; // 'produced' | 'discarded'
   * else executed.error.faultKind;
   */
  async tryExecute(
    param: ArvoDispatcherExecuteParam<ArvoHandlersOfMembers<TMembers>>,
  ): AsyncResult<ArvoEventHandlerExecuteResponse, ArvoHandlerFault> {
    const continuedTrace = continueTraceFromEvent(
      param.event,
      this.telemetry.tracer,
      ARVO_DISPATCHER_SPAN_NAME,
    );
    const span =
      continuedTrace?.span ??
      this.telemetry.tracer.startSpan(ARVO_DISPATCHER_SPAN_NAME);
    const telemetry = new ArvoExecutionContextTelemetry({
      span,
      meter: this.telemetry.meter,
      logger: this.telemetry.logger,
    });

    try {
      telemetry.addEvent('dispatcher.entered');
      const contractType = param.event.to;
      const handler =
        contractType === null
          ? undefined
          : this.#handlersByType.get(contractType);
      if (handler === undefined) {
        return fromNeverthrow(
          err(await this.#refuseUnhandled(param, telemetry)),
        );
      }
      telemetry.addEvent('dispatcher.picked', {
        'contract.type': handler.contracts.self.type,
      });

      const dependenciesByType: Readonly<
        Record<string, IArvoEventHandlerDependency<any> | undefined>
      > = param.dependencies ?? {};
      const dependency = Object.hasOwn(
        dependenciesByType,
        handler.contracts.self.type,
      )
        ? dependenciesByType[handler.contracts.self.type]
        : undefined;

      const executed = await handler.tryExecute({
        event: this.#inwardEvent(param.event, telemetry),
        state: param.state,
        attempt: param.attempt,
        ...(dependency === undefined ? {} : { dependencies: dependency }),
        ...(param.hooks === undefined ? {} : { hooks: param.hooks }),
        ...(this.middlewares.length === 0
          ? {}
          : { middleware: this.middlewares }),
      });
      // the dispatcher's work is done whatever the handler concluded; a
      // handler's fault is the handler's, recorded on the handler's own span
      telemetry.setSpanOk();
      return executed;
    } catch (thrown) {
      // not a fault, so not the Result's to report; seen on the trace and rethrown as it came
      recording(() =>
        span.recordException(
          thrown instanceof Error ? thrown : textOfThrown(thrown),
        ),
      );
      telemetry.setSpanError(textOfThrown(thrown));
      throw thrown;
    } finally {
      span.end();
    }
  }

  /**
   * Enters the handler the event's `to` names, throwing a fault.
   *
   * Identical to {@link ArvoDispatcher.tryExecute} in every rule.
   *
   * @param param - The event, the state function, the attempt, and the
   * dependencies and hooks for the set.
   * @throws {ArvoHandlerFault} The handler's own, or `handler_not_found`.
   *
   * @example
   * const response = await dispatcher.execute({ event, state, attempt: 0 });
   */
  async execute(
    param: ArvoDispatcherExecuteParam<ArvoHandlersOfMembers<TMembers>>,
  ): Promise<ArvoEventHandlerExecuteResponse> {
    const executed = await this.tryExecute(param);
    if (executed.ok) return executed.value;
    throw executed.error;
  }

  /** The event a handler is entered with: a copy naming the dispatcher's span, where it records. */
  #inwardEvent(
    event: ArvoEvent,
    telemetry: ArvoExecutionContextTelemetry,
  ): ArvoEvent {
    return telemetry.span.isRecording()
      ? mutateArvoEvent(event, { span: telemetry.span })
      : event;
  }

  /** The fault for an event no handler in the set takes, recorded on the dispatcher's span. */
  #refuseUnhandled(
    param: ArvoDispatcherExecuteParam<ArvoHandlersOfMembers<TMembers>>,
    telemetry: ArvoExecutionContextTelemetry,
  ): Promise<ArvoHandlerFault> {
    const handledTypes = [...this.#handlersByType.keys()].join(', ');
    return createArvoHandlerFault({
      contracts: null,
      event: param.event,
      attempt: param.attempt,
      telemetry,
      faultKind: 'handler_not_found',
      message:
        param.event.to === null
          ? `the event carries no to, so no handler here can be picked; a dispatcher enters the handler whose self contract type is the event's to (handled here: ${handledTypes})`
          : `no handler here implements ${param.event.to}; a dispatcher enters only the handler whose self contract type is the event's to (handled here: ${handledTypes})`,
    });
  }

  /**
   * Whether a handler in the set implements a self contract of this `type`.
   * An absent value is never handled.
   *
   * @param contractType - A contract `type`, as an event's `to` carries one.
   *
   * @example
   * dispatcher.handles(event.to);
   */
  handles(contractType: string | null): boolean {
    return contractType !== null && this.#handlersByType.has(contractType);
  }

  /**
   * The largest run timeout any version of any handler in the set resolves
   * to, in milliseconds, or `null` where none sets one.
   */
  get longestRunTimeoutMs(): number | null {
    return this.#longestRunTimeoutMs;
  }

  /**
   * Whether a name may stand outside this set, reporting a refusal rather
   * than throwing.
   *
   * Refused, every rule broken named, where it does not satisfy the
   * contract-declared identifier grammar, equals a handler's self contract
   * `type`, or equals the type of a service any handler declares.
   *
   * @param callerName - The name a sender from outside would use.
   *
   * @example
   * const accepted = dispatcher.tryValidateCallerName('com_acme_api');
   * if (!accepted.ok) accepted.error.issues;
   */
  tryValidateCallerName(
    callerName: string,
  ): Result<string, ArvoDispatcherValidationError> {
    const issues = checkCallerName(callerName, this.handlers);
    return issues.length > 0
      ? fromNeverthrow(err(new ArvoDispatcherValidationError(issues)))
      : fromNeverthrow(ok(callerName));
  }

  /**
   * Whether a name may stand outside this set, throwing a refusal.
   *
   * @param callerName - The name a sender from outside would use.
   * @throws {ArvoDispatcherValidationError} If the name breaks any rule,
   * naming every rule it broke.
   *
   * @example
   * const callerName = dispatcher.validateCallerName('com_acme_api');
   */
  validateCallerName(callerName: string): string {
    const attempt = this.tryValidateCallerName(callerName);
    if (attempt.ok) return attempt.value;
    throw attempt.error;
  }
}
