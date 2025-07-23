import type zodToJsonSchema from 'zod-to-json-schema';
import type ArvoContract from '..';
import type { ArvoSemanticVersion } from '../../types';

/**
 * Represents a version-specific view of an ArvoContract, providing type-safe access
 * to contract specifications for a particular semantic version. This interface acts as
 * a bridge between the base contract and its versioned implementation.
 */
export interface IVersionedArvoContract<
  TContract extends ArvoContract,
  TVersion extends ArvoSemanticVersion & keyof TContract['versions'],
> {
  contract: TContract;
  version: TVersion;
}

/**
 * Represents the standardized JSON Schema structure for an Arvo contract record.
 * This type is used when converting Zod schemas to JSON Schema format for documentation
 * and external system integration.
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
 */
export type VersionedArvoContractJSONSchema = {
  uri: string;
  description: string | null;
  domain: string | null;
  version: ArvoSemanticVersion;
  accepts: ArvoContractRecordJsonSchema;
  systemError: ArvoContractRecordJsonSchema;
  emits: ArvoContractRecordJsonSchema[];
  metadata: Record<string, any> | null;
};
