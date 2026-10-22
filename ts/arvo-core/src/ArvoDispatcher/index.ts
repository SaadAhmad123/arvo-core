import { err, ok } from 'neverthrow';
import {
  type ArvoResolvedTelemetry,
  resolveTelemetry,
} from '../ArvoEventHandler/context/telemetry/resolve.js';
import type { ArvoEventHandlerMiddlewareEntry } from '../ArvoEventHandler/types/middleware.js';
import { fromNeverthrow } from '../result.js';
import type { Result } from '../types.js';
import { ErrorIssue } from '../utils/error-issue.js';
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
  ArvoDispatcherMember,
  ArvoDispatcherOptions,
  ArvoDispatcherSet,
} from './types.js';
import type { ArvoAnyEventHandler } from './typing.js';

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
