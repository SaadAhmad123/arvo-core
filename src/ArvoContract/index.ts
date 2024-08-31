import { z } from 'zod';
import { ArvoContractRecord, IArvoContract } from './types';
import { ArvoContractValidators } from './validators';

/**
 * Extracts the event type from a given type T.
 * @template T - The type to extract the event type from.
 */
type ExtractEventType<T> = T extends { type: infer U } ? U : never;

/**
 * ArvoContract class represents a contract with defined input and output schemas.
 * It provides methods for validating inputs and outputs based on the contract's specifications.
 *
 * @template T - The URI type.
 * @template TAccepts - The accepted record type.
 * @template TEmits - The emitted record type.
 */
export default class ArvoContract<
  T extends string = string,
  TAccepts extends ArvoContractRecord = ArvoContractRecord,
  TEmits extends ArvoContractRecord = ArvoContractRecord,
> {
  private readonly _uri: T;
  private readonly _accepts: TAccepts;
  private readonly _emits: ReadonlyArray<TEmits>;

  /**
   * Creates an instance of ArvoContract.
   * @param {IArvoContract<T, TAccepts, TEmits>} params - The contract parameters.
   */
  constructor(params: IArvoContract<T, TAccepts, TEmits>) {
    this._uri = ArvoContractValidators.contract.uri.parse(params.uri) as T;
    this._accepts = this.validateAccepts(params.accepts);
    this._emits = this.validateEmits(params.emits);

    Object.freeze(this);
  }

  public get uri(): T {
    return this._uri;
  }

  public get accepts(): Readonly<TAccepts> {
    return this._accepts;
  }

  /**
   * Gets all emitted event types and schemas as a readonly record.
   * Use this when you need to access all emitted events at once.
   */
  public get emits(): Readonly<Record<ExtractEventType<TEmits>, TEmits>> {
    return Object.freeze(
      this._emits.reduce(
        (acc, emit) => {
          // @ts-ignore
          acc[emit.type] = emit;
          return acc;
        },
        {} as Record<ExtractEventType<TEmits>, TEmits>,
      ),
    );
  }

  /**
   * Gets a specific emitted event type and schema.
   * Use this when you need to access a single emitted event by its type.
   * @template U - The type of the emit record to retrieve.
   * @param {U} type - The type of the emit record.
   * @returns {Readonly<Extract<TEmits, { type: U }>>} The emit record.
   * @throws {Error} If the emit type is not found in the contract.
   */
  public getEmit<U extends ExtractEventType<TEmits>>(
    type: U,
  ): Readonly<Extract<TEmits, { type: U }>> {
    const emit = this._emits.find((item) => item.type === type);
    if (!emit) {
      throw new Error(`Emit type "${type}" not found in contract`);
    }
    return emit as Extract<TEmits, { type: U }>;
  }

  /**
   * Validates the input against the contract's accept schema.
   * @template U - The type of the input to validate.
   * @param {TAccepts['type']} type - The type of the input.
   * @param {U} input - The input to validate.
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
   * Validates the output against the contract's emit schema.
   * @template U - The type of the output to validate.
   * @param {U} type - The type of the output.
   * @param {unknown} output - The output to validate.
   * @returns {z.SafeParseReturnType<unknown, z.infer<Extract<TEmits, { type: U }>['schema']>>} The validation result.
   * @throws {Error} If the emit type is not found in the contract.
   */
  public validateOutput<U extends ExtractEventType<TEmits>>(
    type: U,
    output: unknown,
  ): z.SafeParseReturnType<
    unknown,
    z.infer<Extract<TEmits, { type: U }>['schema']>
  > {
    const emit = this.emits[type];
    if (!emit) {
      throw new Error(`Emit type "${type}" not found in contract`);
    }
    return emit.schema.safeParse(output);
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
   * @param {TEmits[]} emits - The emits records to validate.
   * @returns {ReadonlyArray<TEmits>} The validated emits records.
   * @private
   */
  private validateEmits(emits: TEmits[]): ReadonlyArray<TEmits> {
    return Object.freeze(
      emits.map((item) => ({
        type: ArvoContractValidators.record.type.parse(item.type),
        schema: item.schema,
      })),
    ) as ReadonlyArray<TEmits>;
  }
}
