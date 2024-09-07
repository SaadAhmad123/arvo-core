import { z } from 'zod';
import { ArvoContractRecord, IArvoContract } from './types';
import { ArvoContractValidators } from './validators';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ArvoErrorSchema } from '../schema';

/**
 * ArvoContract class represents a contract with defined input and output schemas.
 * It provides methods for validating inputs and outputs based on the contract's specifications.
 * An event handler can be bound to it so the this contract may impose the types
 * on inputs and outputs of it
 *
 * @template TUri - The URI of the contract
 * @template TType - The accept type, defaults to string.
 * @template TAcceptSchema - The of the data which the contract bound can accept
 * @template TEmits - The type of records the contract bound handler emits.
 */
export default class ArvoContract<
  TUri extends string = string,
  TType extends string = string,
  TAcceptSchema extends z.ZodTypeAny = z.ZodTypeAny,
  TEmits extends Record<string, z.ZodTypeAny> = Record<string, z.ZodTypeAny>,
> {
  private readonly _uri: TUri;
  private readonly _accepts: ArvoContractRecord<TType, TAcceptSchema>;
  private readonly _emits: TEmits;

  /** (Optional) The Contract description */
  readonly description: string | null;

  /**
   * Creates an instance of ArvoContract.
   * @param params - The contract parameters.
   */
  constructor(params: IArvoContract<TUri, TType, TAcceptSchema, TEmits>) {
    this._uri = ArvoContractValidators.contract.uri.parse(params.uri) as TUri;
    this._accepts = this.validateAccepts(params.accepts);
    this._emits = this.validateEmits(params.emits);
    this.description = params.description || null;
  }

  /**
   * Gets the URI of the contract.
   */
  public get uri(): TUri {
    return this._uri;
  }

  /**
   * Gets the type and schema of the event that the contact
   * bound handler listens to.
   */
  public get accepts(): ArvoContractRecord<TType, TAcceptSchema> {
    return this._accepts;
  }

  /**
   * Gets all event types and schemas that can be emitted by the
   * contract bound handler.
   */
  public get emits(): TEmits {
    return { ...this._emits };
  }

  public get systemError(): ArvoContractRecord<
    `sys.${TType}.error`,
    typeof ArvoErrorSchema
  > {
    return {
      type: `sys.${this._accepts.type}.error`,
      schema: ArvoErrorSchema,
    };
  }

  /**
   * Validates the contract bound handler's input against the
   * contract's accept schema.
   * @template U - The type of the input to validate.
   * @param type - The type of the input event.
   * @param input - The input data to validate.
   * @returns The validation result.
   * @throws If the accept type is not found in the contract.
   */
  public validateInput<U>(type: TType, input: U) {
    if (type !== this._accepts.type) {
      throw new Error(`Accept type "${type}" not found in contract`);
    }
    return this._accepts.schema.safeParse(input);
  }

  /**
   * Validates the contract bound handler's output against the
   * contract's emit schema.
   * @template U - The type of the output to validate.
   * @param type - The type of the output event.
   * @param output - The output data to validate.
   * @returns The validation result.
   * @throws If the emit type is not found in the contract.
   */
  public validateOutput<U extends keyof TEmits>(type: U, output: unknown) {
    const emit = this.emits[type];
    if (!emit) {
      throw new Error(`Emit type "${type.toString()}" not found in contract`);
    }
    return emit.safeParse(output);
  }

  /**
   * Validates the accepts record.
   * @param accepts - The accepts record to validate.
   * @returns The validated accepts record.
   * @private
   */
  private validateAccepts(
    accepts: ArvoContractRecord<TType, TAcceptSchema>,
  ): ArvoContractRecord<TType, TAcceptSchema> {
    return {
      type: ArvoContractValidators.record.type.parse(accepts.type) as TType,
      schema: accepts.schema,
    };
  }

  /**
   * Validates the emits records.
   * @param emits - The emits records to validate.
   * @returns The validated emits records.
   * @private
   */
  private validateEmits(emits: TEmits): TEmits {
    Object.entries(emits).forEach(([key]) =>
      ArvoContractValidators.record.type.parse(key),
    );
    return emits;
  }

  /**
   * Exports the ArvoContract instance as a plain object conforming to the IArvoContract interface.
   * This method can be used to serialize the contract or to create a new instance with the same parameters.
   *
   * @returns An object representing the contract, including its URI, accepts, and emits properties.
   */
  public export(): IArvoContract<TUri, TType, TAcceptSchema, TEmits> {
    return {
      uri: this._uri,
      description: this.description,
      accepts: {
        type: this._accepts.type,
        schema: this._accepts.schema,
      },
      emits: { ...this._emits } as TEmits,
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
  public toJsonSchema(): Record<string, any> {
    return {
      uri: this._uri,
      description: this.description,
      accepts: {
        type: this._accepts.type,
        schema: zodToJsonSchema(this._accepts.schema),
      },
      emits: Object.entries(this._emits).map(([key, value]) => ({
        type: key,
        schema: zodToJsonSchema(value),
      })),
    };
  }
}
