import { z } from 'zod';
import { ArvoContractRecord, IArvoContract } from './types';
import { ArvoContractValidators } from './validators';
import { zodToJsonSchema } from 'zod-to-json-schema';

/**
 * ArvoContract class represents a contract with defined input and output schemas.
 * It provides methods for validating inputs and outputs based on the contract's specifications.
 * An event handler can be bound to it so the this contract may impose the types
 * on inputs and outputs of it
 *
 * @template TUri - The URI type, defaults to string.
 * @template TAccepts - The type of record the contract bound handler accepts, defaults to ArvoContractRecord.
 * @template TEmits - The type of records the contract bound handler emits.
 */
export default class ArvoContract<
  TUri extends string = string,
  TAccepts extends ArvoContractRecord = ArvoContractRecord,
  TEmits extends Record<string, z.ZodTypeAny> = Record<string, z.ZodTypeAny>,
> {
  private readonly _uri: TUri;
  private readonly _accepts: TAccepts;
  private readonly _emits: TEmits;

  /** (Optional) The Contract description */
  readonly description: string | null;

  /**
   * Creates an instance of ArvoContract.
   * @param {IArvoContract<TUri, TAccepts, TEmits>} params - The contract parameters.
   */
  constructor(params: IArvoContract<TUri, TAccepts, TEmits>) {
    this._uri = ArvoContractValidators.contract.uri.parse(params.uri) as TUri;
    this._accepts = this.validateAccepts(params.accepts);
    this._emits = this.validateEmits(params.emits);
    this.description = params.description || null;

    Object.freeze(this);
  }

  /**
   * Gets the URI of the contract.
   * @returns {T} The contract's URI.
   */
  public get uri(): TUri {
    return this._uri;
  }

  /**
   * Gets the type and schema of the event that the contact
   * bound handler listens to.
   * @returns {TAccepts} The frozen accepts object.
   */
  public get accepts(): TAccepts {
    return Object.freeze(this._accepts);
  }

  /**
   * Gets all event types and schemas that can be emitted by the
   * contract bound handler.
   *
   * @returns {TEmits} A record of all emitted events.
   */
  public get emits(): TEmits {
    return { ...this._emits };
  }

  /**
   * Validates the contract bound handler's input against the
   * contract's accept schema.
   * @template U - The type of the input to validate.
   * @param {TAccepts['type']} type - The type of the input event.
   * @param {U} input - The input data to validate.
   * @returns {z.SafeParseReturnType<U, z.infer<TAccepts['schema']>>} The validation result.
   * @throws {Error} If the accept type is not found in the contract.
   */
  public validateInput<U>(
    type: TAccepts['type'],
    input: U,
  ): z.SafeParseReturnType<U, z.infer<TAccepts['schema']>> {
    if (type !== this._accepts.type) {
      throw new Error(`Accept type "${type}" not found in contract`);
    }
    return this._accepts.schema.safeParse(input);
  }

  /**
   * Validates the contract bound handler's output against the
   * contract's emit schema.
   * @template U - The type of the output to validate.
   * @param {U} type - The type of the output event.
   * @param {unknown} output - The output data to validate.
   * @returns {z.SafeParseReturnType<unknown, z.infer<Extract<TEmits, { type: U }>['schema']>>} The validation result.
   * @throws {Error} If the emit type is not found in the contract.
   */
  public validateOutput<U extends keyof TEmits>(
    type: U,
    output: unknown,
  ): z.SafeParseReturnType<
    unknown,
    z.infer<Extract<TEmits, { type: U }>['schema']>
  > {
    const emit = this.emits[type];
    if (!emit) {
      throw new Error(`Emit type "${type.toString()}" not found in contract`);
    }
    return emit.safeParse(output);
  }

  /**
   * Validates the accepts record.
   * @param {TAccepts} accepts - The accepts record to validate.
   * @returns {TAccepts} The validated accepts record.
   * @private
   */
  private validateAccepts(accepts: TAccepts): TAccepts {
    return {
      type: ArvoContractValidators.record.type.parse(accepts.type),
      schema: accepts.schema,
    } as TAccepts;
  }

  /**
   * Validates the emits records.
   * @param {TEmits} emits - The emits records to validate.
   * @returns {TEmits} The validated emits records.
   * @private
   */
  private validateEmits(emits: TEmits): TEmits {
    Object.entries(emits).forEach(([key]) =>
      ArvoContractValidators.record.type.parse(key),
    );
    return Object.freeze(emits);
  }

  /**
   * Exports the ArvoContract instance as a plain object conforming to the IArvoContract interface.
   * This method can be used to serialize the contract or to create a new instance with the same parameters.
   *
   * @returns {IArvoContract<TUri, TAccepts, TEmits>} An object representing the contract, including its URI, accepts, and emits properties.
   */
  public export(): IArvoContract<TUri, TAccepts, TEmits> {
    return {
      uri: this._uri,
      description: this.description,
      accepts: {
        type: this._accepts.type,
        schema: this._accepts.schema,
      } as TAccepts,
      emits: { ...this._emits } as TEmits,
    };
  }

  /**
   * Converts the ArvoContract instance to a JSON Schema representation.
   * This method provides a way to represent the contract's structure and validation rules
   * in a format that conforms to the JSON Schema specification.
   *
   * @returns {Object} An object representing the contract in JSON Schema format, including:
   *   - uri: The contract's URI
   *   - description: The contract's description (if available)
   *   - accepts: An object containing the accepted input type and its JSON Schema representation
   *   - emits: An array of objects, each containing an emitted event type and its JSON Schema representation
   */
  public toJsonSchema() {
    return {
      uri: this._uri,
      description: this.description,
      accepts: {
        type: this._accepts.type,
        schema: zodToJsonSchema(this._accepts.schema),
      },
      emits: Object.entries(this._emits).map(([key, value]) => ({
        type: z.literal(key),
        schema: zodToJsonSchema(value),
      })),
    };
  }
}
