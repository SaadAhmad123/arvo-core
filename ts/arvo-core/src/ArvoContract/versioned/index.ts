import type { ArvoEvent } from '../../ArvoEvent/index.js';
import type { ArvoSemanticVersion } from '../../semver/index.js';
import type { JSONObject, Result } from '../../types.js';
import { assertionResult, checkAgainstVersion, mapOk } from '../assert.js';
import {
  type ArvoContractAssertionError,
  ArvoContractValidationError,
} from '../errors.js';
import {
  type HandlerErrorContract,
  handlerErrorContract,
} from '../handler-error.js';
import type {
  ArvoContractVersionParam,
  AssertableType,
  AssertedArvoEvent,
  NarrowedAssertedArvoEvent,
  PayloadFor,
  ScopeOf,
} from '../types.js';
import { validateVersionedArvoContract } from '../validator.js';
import type { VersionedArvoContractParam } from './types.js';

/**
 * One version of a contract, complete on its own.
 *
 * This is what a handler binds to. It carries its contract's identity as
 * well as its own schemas, so nothing needs a reference back to the
 * `ArvoContract` it came from. Versions never inherit from one another —
 * `1.1.0` is a separate interface from `1.0.0`, not an extension of it.
 *
 * Normally you get one from a contract rather than building it:
 *
 * ```ts
 * const v = contract.versions['1.0.0'];
 * v.dataschema;      // '#/com/order/create/1.0.0'
 * v.error;           // always present, whatever outputs declares
 * ```
 *
 * Throws {@link ArvoContractValidationError} if anything is wrong,
 * reporting every problem at once rather than the first.
 */
export class VersionedArvoContract<
  T extends string = string,
  V extends ArvoSemanticVersion = ArvoSemanticVersion,
  C extends ArvoContractVersionParam = ArvoContractVersionParam,
> {
  /** The event type a handler bound to this contract takes in. */
  readonly type: T;
  /** The version this contract is for. */
  readonly version: V;
  /** The contract's identifier, shared by every version. */
  readonly uri: string;
  readonly description: string | null;
  readonly domain: string | null;
  readonly metadata: JSONObject;
  /** The payload a handler bound to this version receives. */
  readonly input: C['input'];
  /** Every event type this version may produce, keyed by event type. */
  readonly outputs: C['outputs'];
  /** Always present, including when {@link outputs} is empty. */
  readonly error: HandlerErrorContract<T>;

  /** `uri` and `version` joined — what an event of this version carries. */
  get dataschema(): `${string}/${V}` {
    return `${this.uri}/${this.version}`;
  }

  /**
   * Checks whether an event is one this version declares, reporting the
   * outcome rather than throwing.
   *
   * Called with an event alone, it answers which of the three shapes the
   * event belongs to and hands the event back unparameterised — the payload
   * type is a runtime fact until a caller says what they expect. Called with
   * an `expectedType`, it confirms or contradicts that, and the event comes
   * back with the payload type that shape declares.
   *
   * The event returned is the event supplied: the same instance, unchanged.
   * Nothing is rebuilt and no schema default is applied, so a payload the
   * sender left incomplete stays incomplete.
   *
   * The event's `dataschema` is checked here as well as by the contract this
   * version came from. Neither relies on the other, so reaching for a version
   * directly is guarded too — without that, an event from a sibling version
   * would be accepted whenever its payload happened to fit.
   *
   * @example Asking
   * const asserted = v.tryAssert(event);
   * if (asserted.ok) asserted.value.scope;  // 'input' | 'output' | 'error'
   *
   * @example Expecting a type
   * const asserted = v.tryAssert(event, 'com_order_created');
   * if (asserted.ok) asserted.value.event.data.order_id;  // typed
   */
  tryAssert(
    event: ArvoEvent,
  ): Result<AssertedArvoEvent<V>, ArvoContractAssertionError>;
  tryAssert<E extends AssertableType<T, C>>(
    event: ArvoEvent,
    expectedType: E,
  ): Result<
    NarrowedAssertedArvoEvent<V, E, ScopeOf<E, T, C>, PayloadFor<E, T, C>>,
    ArvoContractAssertionError
  >;
  tryAssert(
    event: ArvoEvent,
    expectedType?: string,
  ): Result<AssertedArvoEvent<V>, ArvoContractAssertionError> {
    return assertionResult(
      mapOk(
        checkAgainstVersion({
          event,
          type: this.type,
          uri: this.uri,
          version: this.version,
          input: this.input,
          outputs: this.outputs,
          error: this.error,
          expectedType,
        }),
        (scope) => ({ version: this.version, scope, event }),
      ),
    );
  }

  /**
   * {@link tryAssert}, throwing on failure and returning the value directly.
   *
   * Carries no logic of its own beyond the unwrap.
   *
   * @throws {ArvoContractAssertionError} If the event is not one this version
   * declares, or the expected type is not one it declares.
   */
  assert(event: ArvoEvent): AssertedArvoEvent<V>;
  assert<E extends AssertableType<T, C>>(
    event: ArvoEvent,
    expectedType: E,
  ): NarrowedAssertedArvoEvent<V, E, ScopeOf<E, T, C>, PayloadFor<E, T, C>>;
  assert(event: ArvoEvent, expectedType?: string): AssertedArvoEvent<V> {
    const result =
      expectedType === undefined
        ? this.tryAssert(event)
        : this.tryAssert(event, expectedType as AssertableType<T, C>);
    if (result.ok) return result.value as AssertedArvoEvent<V>;
    throw result.error;
  }

  constructor(param: VersionedArvoContractParam<T, V, C>) {
    const { issues } = validateVersionedArvoContract(param);
    if (issues.length > 0) throw new ArvoContractValidationError(issues);

    this.type = param.type;
    this.version = param.version;
    this.uri = param.uri;
    this.description = param.description;
    this.domain = param.domain;
    this.metadata = Object.freeze({ ...param.metadata });
    this.input = param.input;
    this.outputs = Object.freeze({ ...param.outputs }) as C['outputs'];
    this.error = handlerErrorContract(param.type);

    Object.freeze(this);
  }
}
