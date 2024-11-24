import { z } from 'zod';
import {
  ArvoContractJSONSchema,
  ArvoContractRecord,
  IArvoContract,
} from './types';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ArvoErrorSchema } from '../schema';
import { ArvoSemanticVersion } from '../types';
import { compareSemanticVersions } from '../utils';

/**
 * ArvoContract class represents a contract with defined input and output schemas.
 * It provides methods for validating inputs and outputs based on the contract's specifications.
 * An event handler can be bound to it so the this contract may impose the types
 * on inputs and outputs of it
 *
 * @template TUri - The URI of the contract
 * @template TType - The accept type, defaults to string.
 * @template TVersion - The contract versions
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

  /**
   * Creates an instance of ArvoContract.
   * @param params - The contract parameters.
   */
  constructor(params: IArvoContract<TUri, TType, TVersions>) {
    this._uri = params.uri;
    this._type = params.type;
    this._versions = params.versions;
    this.description = params.description ?? null;
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
   * Get the latest version of the contract
   */
  public get latestVersion(): ArvoSemanticVersion | undefined {
    return (Object.keys(this._versions) as ArvoSemanticVersion[]).sort((a, b) =>
      compareSemanticVersions(
        b,
        a,
      ),
    )[0];
  }

  /**
   * Gets the type and schema of the event that the contact
   * bound handler listens to.
   */
  public accepts<V extends ArvoSemanticVersion & keyof TVersions>(
    version: V,
  ): ArvoContractRecord<TType, TVersions[V]['accepts']> {
    return {
      type: this._type,
      schema: this._versions[version].accepts,
    };
  }

  /**
   * Gets all event types and schemas that can be emitted by the
   * contract bound handler.
   */
  public emits<V extends ArvoSemanticVersion & keyof TVersions>(
    version: V,
  ): TVersions[V]['emits'] {
    return { ...this._versions[version].emits };
  }

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
   * Validates the contract bound handler's input/ accept event against the
   * contract's accept schema.
   * @template U - The type of the input to validate.
   * @template V - The version to use
   * @param version - The version to use
   * @param type - The type of the input event.
   * @param input - The input data to validate.
   * @returns The validation result.
   * @throws If the accept type is not found in the contract.
   */
  public validateAccepts<V extends ArvoSemanticVersion & keyof TVersions, U>(
    version: V,
    type: TType,
    input: U,
  ) {
    if (type !== this._type) {
      throw new Error(
        `Accept type "${type}" for version "${version}" not found in contract "${this._uri}"`,
      );
    }
    return this._versions[version].accepts.safeParse(input);
  }

  /**
   * Validates the contract bound handler's output/ emits against the
   * contract's emit schema.
   * @template U - The type of the output to validate.
   * @param type - The type of the output event.
   * @param output - The output data to validate.
   * @returns The validation result.
   * @throws If the emit type is not found in the contract.
   */
  public validateEmits<
    V extends ArvoSemanticVersion & keyof TVersions,
    E extends string & keyof TVersions[V]['emits'],
    U,
  >(version: V, type: E, output: U) {
    const emit: z.ZodTypeAny | undefined =
      this._versions?.[version]?.emits?.[type];
    if (!emit) {
      throw new Error(
        `Emit type "${type.toString()}" for version "${version}" not found in contract "${this._uri}"`,
      );
    }
    return emit.safeParse(output);
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
   * @returns An object representing the contract in JSON Schema format, including:
   *   - uri: The contract's URI
   *   - description: The contract's description (if available)
   *   - accepts: An object containing the accepted input type and its JSON Schema representation
   *   - emits: An array of objects, each containing an emitted event type and its JSON Schema representation
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
        emits: Object.entries(contract.emits).map(([key, value]) => ({
          type: key,
          schema: zodToJsonSchema(value),
        })),
      })),
    };
  }
}
