import { err, ok } from 'neverthrow';
import type * as z from 'zod/v4/core';
import { ArvoContractValidationError } from '../../ArvoContract/errors.js';
import { VersionedArvoContract } from '../../ArvoContract/versioned/index.js';
import type { ArvoEventValidationError } from '../../ArvoEvent/errors.js';
import type { ArvoEvent } from '../../ArvoEvent/index.js';
import type { ArvoEventParam } from '../../ArvoEvent/types.js';
import { fromNeverthrow } from '../../result.js';
import type { Result } from '../../types.js';
import { ErrorIssue } from '../../utils/error-issue.js';
import { buildAccepted } from './accepted.js';
import { buildEmitted } from './emitted.js';
import { buildError } from './error.js';
import type {
  ContractEventOptions,
  ContractEventParam,
  ErrorEventParam,
} from './types.js';

/** Returns what a builder reported, throwing the failure instead of holding it. */
const unwrap = <R>(built: Result<R, ArvoEventValidationError>): R => {
  if (built.ok) return built.value;
  throw built.error;
};

/**
 * Builds the events one version of a contract declares.
 *
 * Hold one per version and the version stops being an argument: it supplies
 * each event's `type` and `dataschema`, and its own schema checks each payload.
 * Reach one through {@link createArvoEventFactory}.
 *
 * Every method comes in two forms. `createX` returns the event and throws if it
 * would be invalid; `tryCreateX` reports the failure as a value instead — for
 * a payload from outside, where a failure is an outcome rather than a bug.
 *
 * For an event no contract declares, use `createArvoEvent`. To copy one, use
 * `cloneArvoEvent`.
 *
 * @example
 * const orders = createArvoEventFactory(contract.versions['1.0.0']);
 *
 * const requested = orders.createAccepted({
 *   source: 'com.web.checkout',
 *   subject: 'order-42',
 *   data: { items: ['book'] },
 * });
 *
 * const emitted = orders.createEmitted({
 *   type: 'com_order_created',
 *   source: 'com.order.service',
 *   subject: requested.subject,
 *   parentid: requested.id,
 *   data: { order_id: 'o-1' },
 * });
 */
export class ArvoEventFactory<V extends VersionedArvoContract> {
  /** The version every event built here belongs to. */
  readonly contract: V;

  /** @param contract - The version to build events for. */
  constructor(contract: V) {
    this.contract = contract;
    Object.freeze(this);
  }

  /**
   * The event this version accepts, throwing if it would be invalid.
   *
   * `type` and `dataschema` come from the contract. `to` defaults to the
   * contract's `type` — a request is addressed to the handler that accepts it —
   * and a `to` you pass wins. `domain` omitted means the event has no domain;
   * pass a string, or an `ArvoDomain` symbol to read one from somewhere.
   *
   * The payload is checked against the version's `accepts` and the event
   * carries what that check produced, so a value the schema defaults is
   * present even where you omitted it.
   *
   * @throws {ArvoEventValidationError} If the payload does not satisfy
   * `accepts`, or a field breaks a structural rule of an event. The message
   * names every rule that broke.
   *
   * @example
   * const requested = orders.createAccepted({
   *   source: 'com.web.checkout',
   *   subject: 'order-42',
   *   data: { items: ['book'] },
   * });
   * requested.type;           // 'com_order_create', from the contract
   * requested.dataschema;     // '#/com/order/create/1.0.0', from the version
   * requested.to;             // 'com_order_create'
   * requested.data.currency;  // 'GBP' — a schema default, typed as present
   */
  createAccepted(
    param: ContractEventParam<V['accepts']>,
    options?: ContractEventOptions,
  ): ArvoEvent<V['type'], z.output<V['accepts']>> {
    return unwrap(buildAccepted(this.contract, param, options));
  }

  /**
   * The event this version accepts, reporting an invalid one rather than
   * throwing.
   *
   * `type` and `dataschema` come from the contract. `to` defaults to the
   * contract's `type` — a request is addressed to the handler that accepts it —
   * and a `to` you pass wins. `domain` omitted means the event has no domain;
   * pass a string, or an `ArvoDomain` symbol to read one from somewhere.
   *
   * The payload is checked against the version's `accepts` and the event
   * carries what that check produced, so a value the schema defaults is
   * present even where you omitted it. A payload that fails, or a field that
   * breaks a structural rule of an event, comes back as an error naming every
   * rule that broke.
   *
   * @example
   * const attempt = orders.tryCreateAccepted({
   *   source: 'com.web.checkout',
   *   data: untrusted,
   * });
   * if (attempt.ok) send(attempt.value);
   * else attempt.error.issues.forEach((issue) => log(issue.path, issue.message));
   */
  tryCreateAccepted(
    param: ContractEventParam<V['accepts']>,
    options?: ContractEventOptions,
  ): Result<
    ArvoEvent<V['type'], z.output<V['accepts']>>,
    ArvoEventValidationError
  > {
    return buildAccepted(this.contract, param, options);
  }

  /**
   * One of the events this version emits, named by `type`, throwing if it would
   * be invalid.
   *
   * Only a type the version declares among its `emits` is accepted; anything
   * else is a compile error. This version's handler error is derived rather
   * than declared, so it is not among them — build it with `createError`.
   *
   * That type's own schema checks the payload, and the event carries what the
   * check produced. `dataschema` comes from the contract; `to` does not, since
   * where an emitted event goes is yours to say. `domain` omitted means the
   * event has no domain.
   *
   * @throws {ArvoEventValidationError} If the payload does not satisfy that
   * type's schema, or a field breaks a structural rule of an event. The message
   * names every rule that broke.
   *
   * @example
   * const emitted = orders.createEmitted({
   *   type: 'com_order_created',
   *   source: 'com.order.service',
   *   subject: requested.subject,
   *   parentid: requested.id,
   *   data: { order_id: 'o-1' },
   * });
   */
  createEmitted<E extends keyof V['emits'] & string>(
    param: { type: E } & ContractEventParam<V['emits'][E]>,
    options?: ContractEventOptions,
  ): ArvoEvent<E, z.output<V['emits'][E]>> {
    return unwrap(buildEmitted(this.contract, param, options));
  }

  /**
   * One of the events this version emits, named by `type`, reporting an invalid
   * one rather than throwing.
   *
   * Only a type the version declares among its `emits` is accepted; anything
   * else is a compile error. This version's handler error is derived rather
   * than declared, so it is not among them — build it with `tryCreateError`.
   *
   * That type's own schema checks the payload, and the event carries what the
   * check produced. `dataschema` comes from the contract; `to` does not, since
   * where an emitted event goes is yours to say. `domain` omitted means the
   * event has no domain.
   *
   * A payload that fails its schema, or a field that breaks a structural rule
   * of an event, comes back as an error naming every rule that broke.
   *
   * @example
   * const attempt = orders.tryCreateEmitted({
   *   type: 'com_order_created',
   *   source: 'com.order.service',
   *   data: computed,
   * });
   * if (!attempt.ok) attempt.error.issues;
   */
  tryCreateEmitted<E extends keyof V['emits'] & string>(
    param: { type: E } & ContractEventParam<V['emits'][E]>,
    options?: ContractEventOptions,
  ): Result<ArvoEvent<E, z.output<V['emits'][E]>>, ArvoEventValidationError> {
    return buildEmitted(this.contract, param, options);
  }

  /**
   * This version's handler error event, throwing if it would be invalid.
   *
   * Its payload is composed from the error you pass — the error's name, its
   * message, and its stack where it has one — so you never assemble that shape
   * yourself. `type` and `dataschema` come from the contract; `to` does not,
   * since where an error goes is yours to say. `domain` omitted means the event
   * has no domain.
   *
   * @throws {ArvoEventValidationError} If `error` is not an error, or a field
   * breaks a structural rule of an event. The message names every rule that
   * broke.
   *
   * @example
   * catch (caught) {
   *   return orders.createError({
   *     source: 'com.order.service',
   *     subject: requested.subject,
   *     error: caught as Error,
   *   });
   * }
   */
  createError(
    param: ErrorEventParam,
    options?: ContractEventOptions,
  ): ArvoEvent<
    V['handlerError']['type'],
    z.output<V['handlerError']['schema']>
  > {
    return unwrap(buildError(this.contract, param, options));
  }

  /**
   * This version's handler error event, reporting an invalid one rather than
   * throwing.
   *
   * Its payload is composed from the error you pass — the error's name, its
   * message, and its stack where it has one — so you never assemble that shape
   * yourself. `type` and `dataschema` come from the contract; `to` does not,
   * since where an error goes is yours to say. `domain` omitted means the event
   * has no domain.
   *
   * Something that is not an error, or a field that breaks a structural rule of
   * an event, comes back as an error naming every rule that broke.
   *
   * @example
   * const attempt = orders.tryCreateError({
   *   source: 'com.order.service',
   *   error: caught as Error,
   * });
   * if (!attempt.ok) attempt.error.issues;
   */
  tryCreateError(
    param: ErrorEventParam,
    options?: ContractEventOptions,
  ): Result<
    ArvoEvent<V['handlerError']['type'], z.output<V['handlerError']['schema']>>,
    ArvoEventValidationError
  > {
    return buildError(this.contract, param, options);
  }
}

/**
 * A factory for the events one version of a contract declares, reporting an
 * unusable contract rather than throwing.
 *
 * Bind it once and the version stops being an argument at every call site. The
 * factory carries the version it was given, so each event it builds takes its
 * `type` and `dataschema` from that contract and has its payload checked
 * against that version's own schema.
 *
 * Anything that is not a version of a contract comes back as an error — a
 * possibility only for a caller without types, since the parameter admits
 * nothing else.
 *
 * For an event no contract declares, use `tryCreateArvoEvent`. To copy one,
 * use `tryCloneArvoEvent`.
 *
 * @param contract - The version to build events for, reached as
 * `contract.versions['1.0.0']`.
 *
 * @example
 * const built = tryCreateArvoEventFactory(contract.versions['1.0.0']);
 * if (!built.ok) return built.error;
 *
 * const requested = built.value.createAccepted({
 *   source: 'com.web.checkout',
 *   subject: 'order-42',
 *   data: { items: ['book'] },
 * });
 */
export const tryCreateArvoEventFactory = <V extends VersionedArvoContract>(
  contract: V,
): Result<ArvoEventFactory<V>, ArvoContractValidationError> => {
  if (!(contract instanceof VersionedArvoContract)) {
    return fromNeverthrow(
      err(
        new ArvoContractValidationError([
          new ErrorIssue({
            path: 'contract',
            message: 'must be a version of a contract',
            received: contract,
          }),
        ]),
      ),
    );
  }

  return fromNeverthrow(ok(new ArvoEventFactory(contract)));
};

/**
 * A factory for the events one version of a contract declares.
 *
 * Bind it once and the version stops being an argument at every call site. The
 * factory carries the version it was given, so each event it builds takes its
 * `type` and `dataschema` from that contract and has its payload checked
 * against that version's own schema.
 *
 * For an event no contract declares, use `createArvoEvent`. To copy one, use
 * `cloneArvoEvent`.
 *
 * @param contract - The version to build events for, reached as
 * `contract.versions['1.0.0']`.
 *
 * @throws {ArvoContractValidationError} If `contract` is not a version of a
 * contract — reachable only from a caller without types.
 *
 * @example
 * const orders = createArvoEventFactory(contract.versions['1.0.0']);
 *
 * const requested = orders.createAccepted({
 *   source: 'com.web.checkout',
 *   subject: 'order-42',
 *   data: { items: ['book'] },
 * });
 *
 * const failed = orders.createError({
 *   source: 'com.order.service',
 *   subject: requested.subject,
 *   error: caught,
 * });
 */
export const createArvoEventFactory = <V extends VersionedArvoContract>(
  contract: V,
): ArvoEventFactory<V> => {
  const built = tryCreateArvoEventFactory(contract);
  if (built.ok) return built.value;
  throw built.error;
};
