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
 * Reach a version by indexing `versions`. Only declared versions exist, and
 * each keeps its own schema types, so `z.infer` differs between them.
 * Versions are independent -- `1.1.0` is a separate interface from `1.0.0`,
 * not an extension of it.
 *
 * Throws {@link ArvoContractValidationError} listing every problem at once,
 * not just the first.
 *
 * @example Minimal -- uri, description, domain and metadata all default
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
 * contract.uri;                       // '#/com/order/create'
 * contract.versions['1.0.0'].dataschema;  // '#/com/order/create/1.0.0'
 *
 * @example Two versions, each with its own payload type
 * const contract = new ArvoContract({
 *   type: 'com_order_create',
 *   versions: {
 *     '1.0.0': { accepts: z.object({ items: z.array(z.string()) }), emits: {} },
 *     '1.1.0': {
 *       accepts: z.object({
 *         items: z.array(z.string()),
 *         shipping_tier: z.enum(['standard', 'express']),
 *       }),
 *       emits: {},
 *     },
 *   },
 * });
 *
 * type V1 = z.infer<typeof contract.versions['1.0.0']['accepts']>;
 * type V11 = z.infer<typeof contract.versions['1.1.0']['accepts']>;
 * contract.versions['9.9.9'];  // compile error -- never declared
 *
 * @example Every field supplied, with an explicit uri
 * const contract = new ArvoContract({
 *   type: 'com_user_register',
 *   uri: '#/services/identity/registration',  // wins over derivation
 *   description: 'Handles user registration',
 *   domain: 'identity_priority',
 *   metadata: { owner: 'team_identity' },
 *   versions: { '1.0.0': { accepts: z.object({ email: z.string() }), emits: {} } },
 * });
 *
 * @example A handler emitting either a declared event or its error
 * const v = contract.versions['1.0.0'];
 * v.emits.com_order_created;  // declared
 * v.handlerError;             // always present, even if emits is empty
 *
 * @example Every problem reported in one attempt
 * new ArvoContract({
 *   type: 'Com_Order_Create',      // not lowercase_snake_case
 *   versions: {
 *     '01.0.0': {                  // leading zero
 *       accepts: z.string(),       // not an object schema
 *       emits: { Bad_Key: z.object({}) },  // not lowercase_snake_case
 *     },
 *   },
 * });
 * // throws, naming all four with paths like versions["01.0.0"].emits["Bad_Key"]
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
