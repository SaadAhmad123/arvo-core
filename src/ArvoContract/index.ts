import { TypeOf, z } from 'zod';
import {
  ArvoContractJSONSchema,
  ArvoContractRecord,
  IArvoContract,
} from './types';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ArvoErrorSchema } from '../schema';
import { ArvoSemanticVersion } from '../types';
import { compareSemanticVersions } from '../utils';
import { VersionedArvoContract } from './VersionedArvoContract';

/**
 * Represents a contract with defined input and output schemas for event-driven architectures.
 * The ArvoContract class provides type-safe validation and versioning capabilities for event handling,
 * ensuring consistency in message passing between different parts of the system.
 *
 * @template TUri - The URI identifier for the contract, must be a string type
 * @template TType - The accept type for the contract, must be a string type
 * @template TVersions - Record of versioned schemas defining contract structure per version
 *
 * @example
 * ```typescript
 * const contract = createArvoContract({
 *   uri: '#/my/service/data',
 *   type: 'com.process.data',
 *   versions: {
 *     '1.0.0': {
 *       accepts: z.object({ data: z.string() }),
 *       emits: {
 *         'data.processed': z.object({ result: z.string() })
 *       }
 *     }
 *   }
 * });
 * ```
 */
export default class ArvoContract<
  TUri extends string = string,
  TType extends string = string,
  TVersions extends Record<
    ArvoSemanticVersion,
    {
      accepts: z.ZodTypeAny;
      emits: Record<string, z.ZodTypeAny>;
    }
  > = Record<
    ArvoSemanticVersion,
    {
      accepts: z.ZodTypeAny;
      emits: Record<string, z.ZodTypeAny>;
    }
  >,
> {
  private readonly _uri: TUri;
  private readonly _type: TType;
  private readonly _versions: TVersions;
  readonly description: string | null;

  constructor(params: IArvoContract<TUri, TType, TVersions>) {
    this._uri = params.uri;
    this._type = params.type;
    this._versions = params.versions;
    this.description = params.description ?? null;

    if (!Object.keys(this._versions).length) {
      throw new Error(
        `An ArvoContract (uri=${this._uri}) must have at least one version`,
      );
    }
  }

  /**
   * Gets the URI of the contract.
   */
  public get uri(): TUri {
    return this._uri;
  }

  /**
   * Get the type of the event the handler
   * bound to the contract accepts
   */
  public get type(): TType {
    return this._type;
  }

  /**
   * Gets the version of the contract
   */
  public get versions(): TVersions {
    return this._versions;
  }

  /**
   * Gets the system error event specification for this contract.
   * System errors follow a standardized format to handle exceptional conditions
   * and failures in a consistent way across all contracts.
   *
   * The error schema includes:
   *   - errorName: The name/type of the error
   *   - errorMessage: A descriptive message about what went wrong
   *   - errorStack: Optional stack trace information (null if not available)
   *
   * System errors are special events that:
   * - Are automatically prefixed with 'sys.' and suffixed with '.error'
   * - Use a standardized schema across all contracts
   * - Can capture error details, messages, and stack traces
   * - Are version-independent (work the same across all contract versions)
   */
  public get systemError(): ArvoContractRecord<
    `sys.${TType}.error`,
    typeof ArvoErrorSchema
  > {
    return {
      type: `sys.${this._type}.error`,
      schema: ArvoErrorSchema,
    };
  }

  /**
   * Retrieves a specific version of the contract or resolves special version identifiers.
   *
   * @template V - Type parameter constrained to valid semantic versions in TVersions
   * @template S - Type parameter for special version identifiers
   *
   * @param option - Version identifier or special version string
   * - Specific version (e.g., "1.0.0")
   * - "latest" or "any" for the most recent version
   * - "oldest" for the first version
   *
   * @returns A versioned contract instance with type-safe schemas
   *
   * @throws {Error} When an invalid or non-existent version is requested
   */
  public version<
    V extends ArvoSemanticVersion & keyof TVersions,
    S extends 'any' | 'latest' | 'oldest',
  >(
    option: V | S,
  ): V extends ArvoSemanticVersion
    ? VersionedArvoContract<typeof this, V>
    : VersionedArvoContract<
        typeof this,
        ArvoSemanticVersion & keyof TVersions
      > {
    let resolvedVersion: ArvoSemanticVersion & keyof TVersions;

    if (option === 'any' || option === 'latest') {
      resolvedVersion = this.getSortedVersionNumbers('DESC')[0];
    } else if (option === 'oldest') {
      resolvedVersion = this.getSortedVersionNumbers('ASC')[0];
    } else if (!this._versions[option as ArvoSemanticVersion]) {
      throw new Error(
        `The contract (uri=${this._uri}) does not have version=${option}`,
      );
    } else {
      resolvedVersion = option as V;
    }

    return {
      uri: this._uri,
      description: this.description,
      version: resolvedVersion,
      accepts: {
        type: this._type,
        schema: this._versions[resolvedVersion].accepts,
      },
      systemError: this.systemError,
      emits: this._versions[resolvedVersion].emits,
    } as any; // needed due to TypeScript limitations with conditional types
  }

  /**
   * Retrieves version numbers in sorted order based on semantic versioning rules.
   *
   * @param ordering - Sort direction for versions
   * - 'ASC' - Ascending order (oldest to newest)
   * - 'DESC' - Descending order (newest to oldest)
   *
   * @returns Array of semantic versions sorted according to specified ordering
   */
  public getSortedVersionNumbers(ordering: 'ASC' | 'DESC') {
    const sorted = (Object.keys(this._versions) as ArvoSemanticVersion[]).sort(
      (a, b) => compareSemanticVersions(b, a),
    );
    return ordering === 'DESC' ? sorted : sorted.reverse();
  }

  /**
   * Exports the ArvoContract instance as a plain object conforming to the IArvoContract interface.
   * This method can be used to serialize the contract or to create a new instance with the same parameters.
   *
   * @returns An object representing the contract, including its URI, accepts, and emits properties.
   */
  public export(): IArvoContract<TUri, TType, TVersions> {
    return {
      uri: this._uri,
      type: this._type,
      description: this.description,
      versions: this._versions,
    };
  }

  /**
   * Converts the ArvoContract instance to a JSON Schema representation.
   * This method provides a way to represent the contract's structure and validation rules
   * in a format that conforms to the JSON Schema specification.
   *
   * @returns An object representing the contract in JSON Schema format:
   */
  public toJsonSchema(): ArvoContractJSONSchema {
    return {
      uri: this._uri,
      description: this.description,
      versions: Object.entries(this._versions).map(([version, contract]) => ({
        version: version as ArvoSemanticVersion,
        accepts: {
          type: this._type,
          schema: zodToJsonSchema(contract.accepts),
        },
        systemError: {
          type: this.systemError.type,
          schema: zodToJsonSchema(this.systemError.schema),
        },
        emits: Object.entries(contract.emits).map(([key, value]) => ({
          type: key,
          schema: zodToJsonSchema(value),
        })),
      })),
    };
  }
}
