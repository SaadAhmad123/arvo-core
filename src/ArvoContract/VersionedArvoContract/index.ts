import zodToJsonSchema from 'zod-to-json-schema';
import ArvoContract from '..';
import { ArvoSemanticVersion } from '../../types';
import { ArvoContractRecord } from '../types';
import {
  IVersionedArvoContract,
  VersionedArvoContractJSONSchema,
} from './types';
import { transformEmitsToArray } from './utils';
import { logToSpan } from '../../OpenTelemetry';

/**
 * Implements a version-specific view of an ArvoContract with type-safe schema validation
 * and JSON Schema generation capabilities.
 *
 * @template TContract - Base ArvoContract type containing version information
 * @template TVersion - Specific semantic version being implemented
 * @template TMetadata - The contract metadata
 */
export class VersionedArvoContract<
  TContract extends ArvoContract,
  TVersion extends ArvoSemanticVersion & keyof TContract['versions'],
  TMetaData extends Record<string, any> = Record<string, any>,
> {
  /** Unique identifier for this contract, inherited from the base contract */
  public readonly uri: TContract['uri'];

  /** Semantic version of this contract implementation */
  public readonly version: TVersion;

  /** Optional description explaining the contract's purpose */
  public readonly description: string | null;

  /** Specification of events this contract accepts */
  public readonly accepts: ArvoContractRecord<
    TContract['type'],
    TContract['versions'][TVersion]['accepts']
  >;

  /** Map of event types to their validation schemas */
  public readonly emitMap: TContract['versions'][TVersion]['emits'];

  /** Array form of emittable events with type/schema pairs */
  public readonly emits: ReturnType<
    typeof transformEmitsToArray<TContract, TVersion>
  >;

  /** The metadate of the contract */
  public readonly metadata: TMetaData;

  /** The automatically generated system error of the contract */
  public readonly systemError: TContract['systemError'];

  constructor(param: IVersionedArvoContract<TContract, TVersion, TMetaData>) {
    this.uri = param.uri;
    this.version = param.version;
    this.description = param.description;
    this.accepts = param.accepts;
    this.emitMap = param.emits;
    this.emits = transformEmitsToArray(this.emitMap);
    this.metadata = param.metadata;
    this.systemError = param.systemError;
  }

  /**
   * Converts the contract to JSON Schema format
   * @param [includeMetadata] - Whether to include metadata. Default is false.
   * @returns Contract specification in JSON Schema format for documentation/serialization
   */
  public toJsonSchema(
    includeMetadata: boolean = false,
  ): VersionedArvoContractJSONSchema {
    try {
      return {
        uri: this.uri,
        description: this.description,
        version: this.version,
        metadata: includeMetadata ? this.metadata : null,
        accepts: {
          type: this.accepts.type,
          schema: zodToJsonSchema(this.accepts.schema),
        },
        systemError: {
          type: this.systemError.type,
          schema: zodToJsonSchema(this.systemError.schema),
        },
        emits: Object.entries(this.emitMap).map(([key, value]) => ({
          type: key,
          schema: zodToJsonSchema(value),
        })),
      };
    } catch (e) {
      logToSpan({
        level: 'ERROR',
        message: `VersionedArvoContract.toJsonSchema failed: ${(e as Error).message}`,
      });
      throw new Error(
        `VersionedArvoContract.toJsonSchema failed: ${(e as Error).message}`,
      );
    }
  }
}
