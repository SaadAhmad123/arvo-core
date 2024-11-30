import zodToJsonSchema from 'zod-to-json-schema';
import ArvoContract from '..';
import { ArvoErrorSchema } from '../../schema';
import { ArvoSemanticVersion } from '../../types';
import { ArvoContractRecord } from '../types';

/**
 * Represents a version-specific view of an ArvoContract, providing type-safe access
 * to contract specifications for a particular semantic version. This interface acts as
 * a bridge between the base contract and its versioned implementation.
 *
 * @template TContract - Base ArvoContract defining core structure and types
 * @template TVersion - Semantic version identifier like "1.0.0"
 * @template TMetaData - Optional metadata record type
 *
 * @property uri - The URI that uniquely identifies this contract within your system
 * @property version - The semantic version (e.g., "1.0.0") representing this specific contract version
 * @property description - Optional human-readable description explaining the contract's purpose
 * @property accepts - Specification for events this contract version can accept
 * @property accepts.type - The event type identifier this version accepts (e.g., "user.created")
 * @property accepts.schema - Zod schema for validating incoming events against this version's requirements
 * @property systemError - Specification for system-level error events
 * @property systemError.type - The error event type, automatically prefixed with "sys." and suffixed with ".error"
 * @property systemError.schema - Zod schema defining the structure of system error events
 * @property emits - Record mapping event types to their corresponding Zod validation schemas
 * @property metadata - Additional version-specific information.
 */
export interface IVersionedArvoContract<
  TContract extends ArvoContract,
  TVersion extends ArvoSemanticVersion & keyof TContract['versions'],
  TMetaData extends Record<string, any> = Record<string, any>,
> {
  uri: TContract['uri'];
  version: TVersion;
  description: string | null;

  accepts: ArvoContractRecord<
    TContract['type'],
    TContract['versions'][TVersion]['accepts']
  >;
  systemError: TContract['systemError'];
  emits: TContract['versions'][TVersion]['emits'];
  metadata: TMetaData;
}

/**
 * Represents the standardized JSON Schema structure for an Arvo contract record.
 * This type is used when converting Zod schemas to JSON Schema format for documentation
 * and external system integration.
 *
 * @property type - String identifier for the contract record (e.g., event type or error type)
 * @property schema - The JSON Schema representation of the Zod validation schema
 */
export type ArvoContractRecordJsonSchema = {
  type: string;
  schema: ReturnType<typeof zodToJsonSchema>;
};

/**
 * Defines the complete JSON Schema representation of a versioned Arvo contract.
 * This type provides a serializable format suitable for documentation generation,
 * API specifications, and cross-system compatibility.
 *
 * The structure follows JSON Schema conventions while maintaining all essential
 * contract information including versioning, event specifications, and validation rules.
 *
 * @property uri - Unique identifier for the contract, used for system-wide reference
 * @property description - Human-readable explanation of the contract's purpose and behavior
 * @property version - Semantic version identifier indicating the contract specification version
 * @property accepts - JSON Schema representation of acceptable input events
 * @property systemError - JSON Schema specification for system-level error events
 * @property emits - Array of JSON Schema specifications for all events this contract can emit
 */
export type VersionedArvoContractJSONSchema = {
  uri: string;
  description: string | null;
  version: ArvoSemanticVersion;
  accepts: ArvoContractRecordJsonSchema;
  systemError: ArvoContractRecordJsonSchema;
  emits: ArvoContractRecordJsonSchema[];
  metadata: Record<string, any> | null;
};
