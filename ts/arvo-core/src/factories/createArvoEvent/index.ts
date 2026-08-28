import type * as z from 'zod/v4/core';
import type { VersionedArvoContract } from '../../ArvoContract/versioned/index.js';
import type { ArvoEventValidationError } from '../../ArvoEvent/errors.js';
import type { ArvoEvent } from '../../ArvoEvent/index.js';
import type { ArvoEventParam } from '../../ArvoEvent/types.js';
import type { PartialExcept, Result } from '../../types.js';
import { byContract } from './by-contract.js';
import { clone } from './clone.js';
import { forContract } from './for-contract.js';
import { handlerError } from './handler-error.js';
import { raw } from './raw.js';
import type {
  ContractEventOptions,
  ContractEventParam,
  ErrorEventParam,
} from './types.js';

/**
 * Builds events, reporting an invalid one rather than throwing.
 *
 * Call it with an event's fields, or reach a variant that reads a contract and
 * supplies what that contract already knows:
 *
 * | | builds |
 * |---|---|
 * | `tryCreateArvoEvent` | an event from the fields you give it |
 * | `.clone` | an existing event, with fields replaced |
 * | `.for` | the event a version accepts |
 * | `.by` | one of the events a version emits |
 * | `.error` | a version's handler error, from an `Error` |
 *
 * The three contract-aware variants check the payload against the version's
 * own schema first, and the built event carries what that check produced — so
 * a value the schema defaults is present even where you omitted it.
 *
 * @example A payload from outside, where failure is an outcome
 * const attempt = tryCreateArvoEvent.for(orders.versions['1.0.0'], {
 *   source: 'com.web.checkout',
 *   subject: 'order-42',
 *   data: untrusted,
 * });
 * if (attempt.ok) send(attempt.value);
 * else attempt.error.issues.forEach((issue) => log(issue.path, issue.message));
 */
export const tryCreateArvoEvent = Object.freeze(
  Object.assign(raw, {
    clone,
    for: forContract,
    by: byContract,
    error: handlerError,
  }),
);

/**
 * Builds events, throwing if the event would be invalid.
 *
 * The same five as {@link tryCreateArvoEvent}, each returning the event
 * directly. Reach for this when you are building an event yourself and expect
 * it to be valid; reach for `tryCreateArvoEvent` when a payload comes from
 * outside, where a failure is an outcome rather than a bug.
 *
 * @example The event a version accepts
 * const requested = createArvoEvent.for(orders.versions['1.0.0'], {
 *   source: 'com.web.checkout',
 *   subject: 'order-42',
 *   data: { items: ['book'] },
 * });
 * requested.type;        // 'com_order_create', from the contract
 * requested.dataschema;  // '#/com/order/create/1.0.0', from the version
 * requested.to;          // 'com_order_create' — the handler that accepts it
 *
 * @example One it emits, and the error when it cannot
 * createArvoEvent.by(v1, {
 *   type: 'com_order_created',     // only a type this version emits
 *   source: 'com.order.service',
 *   subject: requested.subject,
 *   parentid: requested.id,
 *   data: { order_id: 'o-1' },
 * });
 *
 * createArvoEvent.error(v1, {
 *   source: 'com.order.service',
 *   subject: requested.subject,
 *   error: caught,                 // becomes the handler error payload
 * });
 *
 * @example An event with fields replaced
 * createArvoEvent.clone(emitted, { to: 'com.audit.log', id: freshId });
 */
export interface CreateArvoEvent {
  /**
   * An event from the fields you give it.
   *
   * `type`, `data`, `source` and `dataschema` are required. `subject` starts a
   * new execution when omitted.
   *
   * @throws {ArvoEventValidationError} If any field breaks a structural rule.
   */
  <T extends string, D extends Record<string, any>>(
    param: PartialExcept<
      ArvoEventParam<T, D>,
      'type' | 'data' | 'source' | 'dataschema'
    >,
  ): ArvoEvent<T, D>;

  /**
   * An existing event with the fields you replace, everything else copied —
   * `id` and `time` included, so a clone sent alongside its source needs a new
   * `id`.
   *
   * @throws {ArvoEventValidationError} If a replacement breaks a structural
   * rule.
   */
  clone<T extends string, D extends Record<string, any>>(
    event: ArvoEvent<T, D>,
    overrides?: Partial<ArvoEventParam<T, D>>,
  ): ArvoEvent<T, D>;

  /**
   * The event this version accepts. Its `type`, `dataschema` and `to` come
   * from the contract.
   *
   * @throws {ArvoEventValidationError} If the payload does not satisfy the
   * version's `accepts`, or a field breaks a structural rule.
   */
  for<V extends VersionedArvoContract>(
    contract: V,
    param: ContractEventParam<V['accepts']>,
    options?: ContractEventOptions,
  ): ArvoEvent<V['type'], z.output<V['accepts']>>;

  /**
   * One of the events this version emits, named by `type`. Anything it does
   * not declare is a compile error.
   *
   * @throws {ArvoEventValidationError} If the payload does not satisfy that
   * type's schema, or a field breaks a structural rule.
   */
  by<V extends VersionedArvoContract, E extends keyof V['emits'] & string>(
    contract: V,
    param: { type: E } & ContractEventParam<V['emits'][E]>,
    options?: ContractEventOptions,
  ): ArvoEvent<E, z.output<V['emits'][E]>>;

  /**
   * This version's handler error event, its payload composed from the error
   * you pass.
   *
   * @throws {ArvoEventValidationError} If `error` is not an error, or a field
   * breaks a structural rule.
   */
  error<V extends VersionedArvoContract>(
    contract: V,
    param: ErrorEventParam,
    options?: ContractEventOptions,
  ): ArvoEvent<
    V['handlerError']['type'],
    z.output<V['handlerError']['schema']>
  >;
}

/** Returns what a factory reported, throwing the failure instead of holding it. */
const throwing =
  <A extends unknown[], R>(
    build: (...args: A) => Result<R, ArvoEventValidationError>,
  ) =>
  (...args: A): R => {
    const built = build(...args);
    if (built.ok) return built.value;
    throw built.error;
  };

// Wrapping a generic function drops its generics, so the surface is declared
// above and restated here once. Every member carries no logic beyond the
// unwrap, so the two forms cannot disagree about what is valid.
export const createArvoEvent: CreateArvoEvent = Object.freeze(
  Object.assign(throwing(raw), {
    clone: throwing(clone),
    for: throwing(forContract),
    by: throwing(byContract),
    error: throwing(handlerError),
  }),
) as CreateArvoEvent;
