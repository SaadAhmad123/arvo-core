import { z } from 'zod';
import { ArvoSemanticVersion } from '../types';
import { VersionedArvoContractJSONSchema } from './VersionedArvoContract/types';

/**
 * Represents a record in an Arvo contract, containing a type identifier and its validation schema.
 *
 * @template TType - The type identifier for the record, must be a string type
 * @template TSchema - The Zod schema used for validation, must be a Zod type
 */
export type ArvoContractRecord<
  TType extends string = string,
  TSchema extends z.ZodTypeAny = z.ZodTypeAny,
> = {
  /** The type identifier for this record */
  type: TType;
  /** The Zod schema used for validating data associated with this record */
  schema: TSchema;
};

/**
 * Utility type that resolves the inferred TypeScript type from an ArvoContractRecord's schema.
 *
 * @template T - The ArvoContractRecord whose schema type should be inferred
 */
export type ResolveArvoContractRecord<T extends ArvoContractRecord> = z.infer<
  T['schema']
>;

/**
 * Defines the structure of an Arvo contract, including its identifier, type, and versioned schemas.
 *
 * @template TUri - The unique URI identifier for the contract
 * @template TType - The event type that the contract's handler accepts
 * @template TVersions - A record of versioned schemas, mapping semantic versions to their accept/emit schemas
 * @template TMetaData - Optional metadata type
 */
export interface IArvoContract<
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
  TMetaData extends Record<string, any> = Record<string, any>,
> {
  /** The unique URI identifier for this contract */
  uri: TUri;
  /** The event type that this contract's handler accepts */
  type: TType;
  /** Optional description providing context about the contract or its handler */
  description: string | null;
  /** The contract metadata */
  metadata: TMetaData;
  /** A record mapping semantic versions to their corresponding schemas */
  versions: TVersions;
}

/**
 * Represents the JSON Schema representation of an ArvoContract, used for serialization
 * and documentation purposes. This structure follows the JSON Schema specification.
 */
export type ArvoContractJSONSchema = {
  uri: string;
  description: string | null;
  metadata: Record<string, any> | null;
  versions: Omit<VersionedArvoContractJSONSchema, 'uri' | 'description'>[];
};
