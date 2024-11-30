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
 */
export class VersionedArvoContract<
  TContract extends ArvoContract,
  TVersion extends ArvoSemanticVersion & keyof TContract['versions'],
  TMetaData extends Record<string, any> = Record<string, any>,
> {
  private readonly _uri: TContract['uri'];
  private readonly _version: TVersion;
  private readonly _description: string | null;
  private readonly _accepts: ArvoContractRecord<
    TContract['type'],
    TContract['versions'][TVersion]['accepts']
  >;
  private readonly _emitMap: TContract['versions'][TVersion]['emits'];
  private readonly _emits: ReturnType<
    typeof transformEmitsToArray<TContract, TVersion>
  >;
  private readonly _metadata: TMetaData;
  private readonly _systemError: TContract['systemError'];

  public get uri() {
    return this._uri;
  }
  public get version() {
    return this._version;
  }
  public get description() {
    return this._description;
  }
  public get accepts() {
    return this._accepts;
  }
  public get emitMap() {
    return this._emitMap;
  }
  public get metadata() {
    return this._metadata;
  }
  public get systemError() {
    return this._systemError;
  }
  public get emits() {
    return this._emits;
  }

  constructor(param: IVersionedArvoContract<TContract, TVersion, TMetaData>) {
    this._uri = param.uri;
    this._version = param.version;
    this._description = param.description;
    this._accepts = param.accepts;
    this._emitMap = param.emits;
    this._emits = transformEmitsToArray(this.emitMap);
    this._metadata = param.metadata;
    this._systemError = param.systemError;
  }

  /**
   * Converts the contract to JSON Schema format
   * @returns Contract specification in JSON Schema format for documentation/serialization
   */
  public toJsonSchema(): VersionedArvoContractJSONSchema {
    try {
      return {
        uri: this._uri,
        description: this._description,
        version: this._version,
        metadata: this._metadata,
        accepts: {
          type: this._accepts.type,
          schema: zodToJsonSchema(this._accepts.schema),
        },
        systemError: {
          type: this._systemError.type,
          schema: zodToJsonSchema(this._systemError.schema),
        },
        emits: Object.entries(this._emitMap).map(([key, value]) => ({
          type: key,
          schema: zodToJsonSchema(value),
        })),
      };
    } catch (e) {
      const errorMessage = `VersionedArvoContract.toJsonSchema failed: ${(e as Error).message}`;
      logToSpan({
        level: 'ERROR',
        message: errorMessage,
      });
      throw new Error(errorMessage);
    }
  }
}
