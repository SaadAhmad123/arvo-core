import { z } from 'zod';

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
