import { z } from 'zod';
import zodToJsonSchema from 'zod-to-json-schema';

/**
 * Represents a record in an Arvo contract.
 * @template TType - The type of the record, defaults to string.
 * @template TSchema - The Zod schema for the record, defaults to any Zod type.
 */
export type ArvoContractRecord<
  TType extends string = string,
  TSchema extends z.ZodTypeAny = z.ZodTypeAny,
> = {
  /** The type identifier for the record */
  type: TType;
  /** The Zod schema used for validating the record */
  schema: TSchema;
};

/**
 * Interface for an Arvo contract.
 *
 * @template TUri - The URI of the contract
 * @template TType - The accept type, defaults to string.
 * @template TAcceptSchema - The of the data which the contract bound can accept
 * @template TEmits - The type of records the contract bound handler emits.
 */
export interface IArvoContract<
  TUri extends string = string,
  TType extends string = string,
  TAcceptSchema extends z.ZodTypeAny = z.ZodTypeAny,
  TEmits extends Record<string, z.ZodTypeAny> = Record<string, z.ZodTypeAny>,
> {
  /** The unique identifier for the contract */
  uri: TUri;
  /** The record type that the contract accepts */
  accepts: ArvoContractRecord<TType, TAcceptSchema>;
  /** An array of record types that the contract can emit */
  emits: TEmits;
  /** (Optional) The description of the contract or its handler */
  description?: string | null;
}

/**
 * Resolves the inferred type of an ArvoContractRecord's schema.
 * @template T - The ArvoContractRecord to resolve.
 */
export type ResolveArvoContractRecord<T extends ArvoContractRecord> = z.infer<
  T['schema']
>;

/**
 * Represents the JSON Schema representation of an ArvoContract.
 */
export type ArvoContractJSONSchema = {
  /** The unique identifier (URI) of the contract */
  uri: string;

  /** The description of the contract (null if not provided) */
  description: string | null;

  /** The accepted input schema for the contract */
  accepts: {
    /** The type identifier for the accepted input */
    type: string;

    /** The JSON Schema representation of the accepted input schema */
    schema: ReturnType<typeof zodToJsonSchema>;
  };

  /** An array of emitted event schemas for the contract */
  emits: {
    /** The type identifier for the emitted event */
    type: string;

    /** The JSON Schema representation of the emitted event schema */
    schema: ReturnType<typeof zodToJsonSchema>;
  }[];
};
