import type { z } from 'zod';
import { logToSpan } from '../OpenTelemetry';
import { ArvoErrorSchema, ArvoSemanticVersionSchema } from '../schema';
import type { ArvoSemanticVersion } from '../types';
import { compareSemanticVersions } from '../utils';
import { VersionedArvoContract } from './VersionedArvoContract';
import { WildCardArvoSemanticVersion, isWildCardArvoSematicVersion } from './WildCardArvoSemanticVersion';
import type { ArvoContractJSONSchema, ArvoContractParam, ArvoContractRecord } from './types';
import { ArvoContractValidators } from './validators';

/**
 * Represents a contract with defined input and output schemas for event-driven architectures.
 * The ArvoContract class provides type-safe validation and versioning capabilities for event handling,
 * ensuring consistency in message passing between different parts of the system.
 *
 * @example
 * ```typescript
 * const contract = createArvoContract({
 *   uri: '#/my/service/data',
 *   type: 'com.process.data',
 *   description: 'An example contract',
 *   metadata: {
 *     visibility: "public"
 *   }
 *   versions: {
 *     '1.0.0': {
 *       accepts: z.object({ data: z.string() }),
 *       emits: {
 *         'data.processed': z.object({ result: z.string() })
 *       }
 *     },
 *     '2.0.0': {
 *       accepts: z.object({ data: z.number() }),
 *       emits: {
 *         'data.processed': z.object({ result: z.number() })
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
  TMetaData extends Record<string, any> = Record<string, any>,
> {
  protected readonly _uri: TUri;
  protected readonly _type: TType;
  protected readonly _versions: TVersions;
  protected readonly _description: string | null;
  protected readonly _metadata: TMetaData;
  protected readonly _domain: string | null;

  public get uri() {
    return this._uri;
  }
  public get type() {
    return this._type;
  }
  public get versions() {
    return this._versions;
  }
  public get description() {
    return this._description;
  }
  public get metadata() {
    return this._metadata;
  }
  public get domain() {
    return this._domain;
  }

  /**
   * Creates a new ArvoContract instance with validated parameters.
   *
   * @param params - Contract configuration parameters
   *
   * @throws {Error} When URI format is invalid
   * @throws {Error} When event type format is invalid
   * @throws {Error} When version string is not valid semantic version
   * @throws {Error} When version is a reserved wildcard version
   * @throws {Error} When emit type format is invalid
   * @throws {Error} When no versions are provided
   * @throws {Error} When domain does not have follow the condition Domain must contain only lowercase letters, numbers, and dots
   */
  constructor(params: ArvoContractParam<TUri, TType, TVersions, TMetaData>) {
    ArvoContractValidators.contract.uri.parse(params.uri);
    ArvoContractValidators.record.type.parse(params.type);
    ArvoContractValidators.contract.domain.parse(params.domain);

    this._uri = params.uri;
    this._type = params.type;
    this._versions = params.versions;
    this._description = params.description ?? null;
    this._metadata = params.metadata;
    this._domain = params.domain;

    for (const [version, versionContract] of Object.entries(params.versions)) {
      ArvoSemanticVersionSchema.parse(version);
      if (isWildCardArvoSematicVersion(version as ArvoSemanticVersion)) {
        throw new Error(
          `For contract (uri=${params.uri}), the version cannot be '${WildCardArvoSemanticVersion}'. It is a reserved version type.`,
        );
      }
      for (const emitType of Object.keys(versionContract.emits)) {
        ArvoContractValidators.record.type.parse(emitType);
      }
    }

    if (!Object.keys(this._versions).length) {
      throw new Error(`An ArvoContract (uri=${this._uri}) must have at least one version`);
    }
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
  public get systemError(): ArvoContractRecord<`sys.${TType}.error`, typeof ArvoErrorSchema> {
    return {
      type: `sys.${this._type}.error`,
      schema: ArvoErrorSchema,
    };
  }

  /**
   * Retrieves a specific version of the contract or resolves special version identifiers.
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
  public version<V extends (ArvoSemanticVersion & keyof TVersions) | 'any' | 'latest' | 'oldest'>(
    option: V,
  ): V extends ArvoSemanticVersion & keyof TVersions
    ? VersionedArvoContract<typeof this, V>
    : VersionedArvoContract<any, any> {
    let resolvedVersion: ArvoSemanticVersion & keyof TVersions;

    if (option === 'any' || option === 'latest') {
      resolvedVersion = this.getSortedVersionNumbers('DESC')[0];
    } else if (option === 'oldest') {
      resolvedVersion = this.getSortedVersionNumbers('ASC')[0];
      // @ts-ignore
    } else if (!this._versions[option]) {
      throw new Error(`The contract (uri=${this._uri}) does not have version=${option}`);
    } else {
      resolvedVersion = option as ArvoSemanticVersion & keyof TVersions;
    }

    return new VersionedArvoContract({
      contract: this,
      version: resolvedVersion,
    }) as any; // needed due to TypeScript limitations with conditional types
  }

  /**
   * Retrieves version numbers in sorted order based on semantic versioning rules.
   * @returns Array of semantic versions sorted according to specified ordering
   */
  public getSortedVersionNumbers(ordering: 'ASC' | 'DESC') {
    const sorted = (Object.keys(this._versions) as ArvoSemanticVersion[]).sort((a, b) => compareSemanticVersions(b, a));
    return ordering === 'DESC' ? sorted : sorted.reverse();
  }

  /**
   * Exports the ArvoContract instance as a plain object conforming to the IArvoContract interface.
   * This method can be used to serialize the contract or to create a new instance with the same parameters.
   */
  public export(): ArvoContractParam<TUri, TType, TVersions> {
    return {
      uri: this._uri,
      type: this._type,
      domain: this._domain,
      description: this._description,
      versions: this._versions,
      metadata: this._metadata,
    };
  }

  /**
   * Converts the ArvoContract instance to a JSON Schema representation.
   * This method provides a way to represent the contract's structure and validation rules
   * in a format that conforms to the JSON Schema specification.
   */
  public toJsonSchema(): ArvoContractJSONSchema {
    try {
      return {
        uri: this._uri,
        domain: this._domain,
        description: this._description,
        metadata: this._metadata,
        versions: Object.keys(this._versions).map((version) => {
          const jsonSchema = this.version(version as ArvoSemanticVersion).toJsonSchema();
          return {
            domain: jsonSchema.domain,
            version: jsonSchema.version,
            accepts: jsonSchema.accepts,
            systemError: jsonSchema.systemError,
            emits: jsonSchema.emits,
            metadata: jsonSchema.metadata,
          };
        }),
      };
    } catch (e) {
      const errorMessage = `ArvoContract.toJsonSchema failed: ${(e as Error).message}`;
      logToSpan({
        level: 'ERROR',
        message: errorMessage,
      });
      throw new Error(errorMessage);
    }
  }
}
