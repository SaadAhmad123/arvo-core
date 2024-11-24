import { z } from 'zod';
import zodToJsonSchema from 'zod-to-json-schema';
import { ArvoSemanticVersion } from '../types';

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
 * Defines the structure of an Arvo contract, including its identifier, type, and versioned schemas.
 *
 * @template TUri - The unique URI identifier for the contract
 * @template TType - The event type that the contract's handler accepts
 * @template TVersions - A record of versioned schemas, mapping semantic versions to their accept/emit schemas
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
> {
  /** The unique URI identifier for this contract */
  uri: TUri;
  /** The event type that this contract's handler accepts */
  type: TType;
  /** Optional description providing context about the contract or its handler */
  description?: string | null;
  /** A record mapping semantic versions to their corresponding schemas */
  versions: TVersions;
}

/**
 * Utility type that resolves the inferred TypeScript type from an ArvoContractRecord's schema.
 *
 * @template T - The ArvoContractRecord whose schema type should be inferred
 */
export type ResolveArvoContractRecord<T extends ArvoContractRecord> = z.infer<
  T['schema']
>;

/**
 * Represents the JSON Schema representation of an ArvoContract, used for serialization
 * and documentation purposes. This structure follows the JSON Schema specification.
 */
export type ArvoContractJSONSchema = {
  /** The unique URI identifier for the contract */
  uri: string;
  /** The human-readable description of the contract */
  description: string | null;
  /** Array of versioned schemas for this contract */
  versions: {
    /** The semantic version identifier for this schema version */
    version: ArvoSemanticVersion;
    /** The schema for accepted inputs in this version */
    accepts: {
      /** The type identifier for accepted inputs */
      type: string;
      /** JSON Schema representation of the input validation schema */
      schema: ReturnType<typeof zodToJsonSchema>;
    };
    /** The system error event */
    systemError: {
      /** The type of the event */
      type: string;
      /** The schema of the error */
      schema: ReturnType<typeof zodToJsonSchema>;
    };
    /** Array of schemas for events that can be emitted in this version */
    emits: {
      /** The type identifier for the emitted event */
      type: string;
      /** JSON Schema representation of the event validation schema */
      schema: ReturnType<typeof zodToJsonSchema>;
    }[];
  }[];
};
