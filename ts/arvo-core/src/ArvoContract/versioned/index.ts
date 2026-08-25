import type { ArvoSemanticVersion } from '../../semver/index.js';
import type { JSONObject } from '../../types.js';
import { ArvoContractValidationError } from '../errors.js';
import {
  type HandlerErrorContract,
  handlerErrorContract,
} from '../handler-error.js';
import type { ArvoContractVersionParam } from '../types.js';
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
 * v.handlerError;    // always present, whatever emits declares
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
  /** The event type a handler bound to this contract accepts. */
  readonly type: T;
  /** The version this contract is for. */
  readonly version: V;
  /** The contract's identifier, shared by every version. */
  readonly uri: string;
  readonly description: string | null;
  readonly domain: string | null;
  readonly metadata: JSONObject;
  /** The payload a handler bound to this version receives. */
  readonly accepts: C['accepts'];
  /** Every event type this version may produce, keyed by event type. */
  readonly emits: C['emits'];
  /** Always present, including when {@link emits} is empty. */
  readonly handlerError: HandlerErrorContract<T>;

  /** `uri` and `version` joined — what an event of this version carries. */
  get dataschema(): `${string}/${V}` {
    return `${this.uri}/${this.version}`;
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
    this.accepts = param.accepts;
    this.emits = Object.freeze({ ...param.emits }) as C['emits'];
    this.handlerError = handlerErrorContract(param.type);

    Object.freeze(this);
  }
}
