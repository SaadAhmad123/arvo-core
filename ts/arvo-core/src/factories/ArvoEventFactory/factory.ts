import type * as z from 'zod/v4/core';
import type { VersionedArvoContract } from '../../ArvoContract/versioned/index.js';
import type { ArvoEventValidationError } from '../../ArvoEvent/errors.js';
import type { ArvoEvent } from '../../ArvoEvent/index.js';
import type { Result } from '../../types.js';
import { buildError } from './error.js';
import { buildInput } from './input.js';
import { buildOutput } from './output.js';
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
 * const requested = orders.createInput({
 *   source: 'com.web.checkout',
 *   subject: 'order-42',
 *   data: { items: ['book'] },
 * });
 *
 * const emitted = orders.createOutput({
 *   type: 'com_order_created',
 *   source: 'com.order.service',
 *   subject: requested.subject,
 *   parentid: requested.id,
 *   data: { order_id: 'o-1' },
 * });
 */
export class ArvoEventFactory<
  V extends VersionedArvoContract = VersionedArvoContract,
> {
  /** The version every event built here belongs to. */
  readonly contract: V;

  /** @param contract - The version to build events for. */
  constructor(contract: V) {
    this.contract = contract;
    Object.freeze(this);
  }

  /**
   * The event this version input, throwing if it would be invalid.
   *
   * `type` and `dataschema` come from the contract. `to` defaults to the
   * contract's `type` — a request is addressed to the handler that input it —
   * and a `to` you pass wins. `domain` omitted means the event has no domain;
   * pass a string, or an `ArvoDomain` symbol to read one from somewhere.
   *
   * The payload is checked against the version's `input` and the event
   * carries what that check produced, so a value the schema defaults is
   * present even where you omitted it.
   *
   * @throws {ArvoEventValidationError} If the payload does not satisfy
   * `input`, or a field breaks a structural rule of an event. The message
   * names every rule that broke.
   *
   * @example
   * const requested = orders.createInput({
   *   source: 'com.web.checkout',
   *   subject: 'order-42',
   *   data: { items: ['book'] },
   * });
   * requested.type;           // 'com_order_create', from the contract
   * requested.dataschema;     // '#/com/order/create/1.0.0', from the version
   * requested.to;             // 'com_order_create'
   * requested.data.currency;  // 'GBP' — a schema default, typed as present
   */
  createInput(
    param: ContractEventParam<V['input']>,
    options?: ContractEventOptions,
  ): ArvoEvent<V['type'], z.output<V['input']>> {
    return unwrap(buildInput(this.contract, param, options));
  }

  /**
   * The event this version input, reporting an invalid one rather than
   * throwing.
   *
   * `type` and `dataschema` come from the contract. `to` defaults to the
   * contract's `type` — a request is addressed to the handler that input it —
   * and a `to` you pass wins. `domain` omitted means the event has no domain;
   * pass a string, or an `ArvoDomain` symbol to read one from somewhere.
   *
   * The payload is checked against the version's `input` and the event
   * carries what that check produced, so a value the schema defaults is
   * present even where you omitted it. A payload that fails, or a field that
   * breaks a structural rule of an event, comes back as an error naming every
   * rule that broke.
   *
   * @example
   * const attempt = orders.tryCreateInput({
   *   source: 'com.web.checkout',
   *   data: untrusted,
   * });
   * if (attempt.ok) send(attempt.value);
   * else attempt.error.issues.forEach((issue) => log(issue.path, issue.message));
   */
  tryCreateInput(
    param: ContractEventParam<V['input']>,
    options?: ContractEventOptions,
  ): Result<
    ArvoEvent<V['type'], z.output<V['input']>>,
    ArvoEventValidationError
  > {
    return buildInput(this.contract, param, options);
  }

  /**
   * One of the events this version outputs, named by `type`, throwing if it would
   * be invalid.
   *
   * Only a type the version declares among its `outputs` is accepted; anything
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
   * const emitted = orders.createOutput({
   *   type: 'com_order_created',
   *   source: 'com.order.service',
   *   subject: requested.subject,
   *   parentid: requested.id,
   *   data: { order_id: 'o-1' },
   * });
   */
  createOutput<E extends keyof V['outputs'] & string>(
    param: { type: E } & ContractEventParam<V['outputs'][E]>,
    options?: ContractEventOptions,
  ): ArvoEvent<E, z.output<V['outputs'][E]>> {
    return unwrap(buildOutput(this.contract, param, options));
  }

  /**
   * One of the events this version outputs, named by `type`, reporting an invalid
   * one rather than throwing.
   *
   * Only a type the version declares among its `outputs` is accepted; anything
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
   * const attempt = orders.tryCreateOutput({
   *   type: 'com_order_created',
   *   source: 'com.order.service',
   *   data: computed,
   * });
   * if (!attempt.ok) attempt.error.issues;
   */
  tryCreateOutput<E extends keyof V['outputs'] & string>(
    param: { type: E } & ContractEventParam<V['outputs'][E]>,
    options?: ContractEventOptions,
  ): Result<ArvoEvent<E, z.output<V['outputs'][E]>>, ArvoEventValidationError> {
    return buildOutput(this.contract, param, options);
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
  ): ArvoEvent<V['error']['type'], z.output<V['error']['schema']>> {
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
    ArvoEvent<V['error']['type'], z.output<V['error']['schema']>>,
    ArvoEventValidationError
  > {
    return buildError(this.contract, param, options);
  }
}
