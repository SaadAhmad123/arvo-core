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
 * @template TUri - The URI type, defaults to string.
 * @template TAccepts - The type of record the contract accepts, defaults to ArvoContractRecord.
 * @template TEmits - The type of record the contract emits, defaults to ArvoContractRecord.
 */
export interface IArvoContract<
  TUri extends string = string,
  TAccepts extends ArvoContractRecord = ArvoContractRecord,
  TEmits extends ArvoContractRecord = ArvoContractRecord,
> {
  /** The unique identifier for the contract */
  uri: TUri;
  /** The record type that the contract accepts */
  accepts: TAccepts;
  /** An array of record types that the contract can emit */
  emits: TEmits[];
}

/**
 * Resolves the inferred type of an ArvoContractRecord's schema.
 * @template T - The ArvoContractRecord to resolve.
 */
export type ResolveArvoContractRecord<T extends ArvoContractRecord> = z.infer<
  T['schema']
>;
