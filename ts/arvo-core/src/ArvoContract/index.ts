import type { ArvoSemanticVersion } from '../semver/index.js';
import type { JSONObject } from '../types.js';
import { ArvoContractValidationError } from './errors.js';
import type {
  ArvoContractParam,
  ArvoContractVersionMapParam,
} from './types.js';
import { validateArvoContract } from './validator.js';
import { VersionedArvoContract } from './versioned/index.js';

/**
 * A versioned declaration of what a handler accepts and what it may emit.
 *
 * ```ts
 * const contract = new ArvoContract({
 *   type: 'com_order_create',
 *   versions: {
 *     '1.0.0': {
 *       accepts: z.object({ items: z.array(z.string()) }),
 *       emits: { com_order_created: z.object({ order_id: z.string() }) },
 *     },
 *   },
 * });
 *
 * contract.uri;                  // '#/com/order/create', derived from type
 * contract.versions['1.0.0'];    // a VersionedArvoContract
 * ```
 *
 * Reach a version by indexing `versions`. Only versions you declared exist,
 * and each keeps its own schema types, so `z.infer` on one version's
 * `accepts` differs from another's. Indexing a version you did not declare
 * is a compile error.
 *
 * Versions are independent. `1.1.0` is a separate interface from `1.0.0` —
 * it inherits nothing and need not be compatible.
 *
 * Throws {@link ArvoContractValidationError} if anything is wrong,
 * reporting every problem across every version at once rather than the
 * first one found.
 */
export class ArvoContract<
  T extends string = string,
  M extends ArvoContractVersionMapParam = ArvoContractVersionMapParam,
> {
  /** The event type a handler bound to this contract accepts. */
  readonly type: T;
  /** Base of every `dataschema` this contract's versions produce. */
  readonly uri: string;
  readonly description: string | null;
  readonly domain: string | null;
  readonly metadata: JSONObject;
  /** Every declared version, keyed by version. */
  readonly versions: {
    [V in keyof M & ArvoSemanticVersion]: VersionedArvoContract<T, V, M[V]>;
  };

  constructor(param: ArvoContractParam<T, M>) {
    const { value, issues } = validateArvoContract(param);
    if (issues.length > 0) throw new ArvoContractValidationError(issues);

    this.type = value.type as T;
    this.uri = value.uri;
    this.description = value.description;
    this.domain = value.domain;
    this.metadata = Object.freeze({ ...value.metadata });

    this.versions = Object.freeze(
      Object.fromEntries(
        Object.entries(value.versions).map(([version, definition]) => [
          version,
          new VersionedArvoContract({
            type: this.type,
            version: version as ArvoSemanticVersion,
            uri: this.uri,
            description: this.description,
            domain: this.domain,
            metadata: this.metadata,
            accepts: definition.accepts,
            emits: definition.emits,
          } as never),
        ]),
      ),
    ) as this['versions'];

    Object.freeze(this);
  }
}
