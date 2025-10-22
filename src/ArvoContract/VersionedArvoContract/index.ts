import zodToJsonSchema from 'zod-to-json-schema';
import type ArvoContract from '..';
import { logToSpan } from '../../OpenTelemetry';
import type { ArvoSemanticVersion } from '../../types';
import { EventDataschemaUtil } from '../../utils';
import { WildCardArvoSemanticVersion } from '../WildCardArvoSemanticVersion';
import type { ArvoContractRecord } from '../types';
import type { VersionedArvoContractJSONSchema, VersionedArvoContractParam } from './types';
import { transformEmitsToArray } from './utils';

/**
 * Implements a version-specific view of an ArvoContract with type-safe schema validation
 * and JSON Schema generation capabilities.
 */
export class VersionedArvoContract<
  TContract extends ArvoContract,
  TVersion extends ArvoSemanticVersion & keyof TContract['versions'],
> {
  protected readonly _contract: TContract;
  protected readonly _version: TVersion;
  protected readonly _accepts: ArvoContractRecord<TContract['type'], TContract['versions'][TVersion]['accepts']>;
  protected readonly _emits: TContract['versions'][TVersion]['emits'];
  protected readonly _emitList: ReturnType<typeof transformEmitsToArray<TContract, TVersion>>;

  public get uri(): TContract['uri'] {
    return this._contract.uri;
  }
  public get version(): TVersion {
    return this._version;
  }
  public get description(): TContract['description'] {
    return this._contract.description;
  }
  public get metadata(): TContract['metadata'] {
    return this._contract.metadata;
  }
  public get systemError(): TContract['systemError'] & {
    dataschema: ReturnType<typeof EventDataschemaUtil.build<TContract['uri'], typeof WildCardArvoSemanticVersion>>;
  } {
    return {
      ...this._contract.systemError,
      dataschema: EventDataschemaUtil.build(this.uri, WildCardArvoSemanticVersion),
    };
  }
  public get accepts() {
    return this._accepts;
  }
  public get emits() {
    return this._emits;
  }
  public get emitList() {
    return this._emitList;
  }
  public get dataschema() {
    return EventDataschemaUtil.build<TContract['uri'], TVersion>(this.uri, this.version);
  }
  public get domain() {
    return this._contract.domain;
  }

  constructor(param: VersionedArvoContractParam<TContract, TVersion>) {
    this._version = param.version;
    this._contract = param.contract;
    this._accepts = {
      type: param.contract.type,
      schema: param.contract.versions[param.version].accepts,
    };
    this._emits = param.contract.versions[param.version].emits;
    this._emitList = transformEmitsToArray(this.emits);
  }

  /**
   * Converts the contract to JSON Schema format
   * @returns Contract specification in JSON Schema format for documentation/serialization
   */
  public toJsonSchema(): VersionedArvoContractJSONSchema {
    try {
      return {
        uri: this.uri,
        description: this.description,
        domain: this.domain,
        version: this.version,
        metadata: this.metadata,
        accepts: {
          type: this._accepts.type,
          schema: zodToJsonSchema(this._accepts.schema),
        },
        systemError: {
          type: this.systemError.type,
          schema: zodToJsonSchema(this.systemError.schema),
        },
        emits: Object.entries(this._emits).map(([key, value]) => ({
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
