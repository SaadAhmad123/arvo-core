import ArvoContract from '.';
import { ArvoErrorSchema } from '../schema';
import { ArvoSemanticVersion } from '../types';

/**
 * Represents a version-specific view of an ArvoContract, providing a structured way to access
 * all contract specifications for a particular semantic version. This type ensures type-safe
 * access to version-specific schemas and event types.
 * 
 * @template TContract - The base ArvoContract type to extract version-specific information from
 * @template TVersion - The specific semantic version of the contract to extract
 * 
 * @property uri - The URI identifying the contract
 * @property version - The specific semantic version being represented
 * @property description - Optional description of the contract version
 * @property accepts - Specification for accepted events in this version
 * @property accepts.type - The event type this version accepts
 * @property accepts.schema - Zod schema for validating accepted events
 * @property systemError - System error event specification
 * @property systemError.type - System error event type (sys.[type].error)
 * @property systemError.schema - Zod schema for system error events
 * @property emits - Record of emittable event types and their Zod schemas
 * 
 * @see {@link ArvoContract} for the base contract class
 * @see {@link ArvoContract.version} for the method to create a versioned view
 */
export type VersionedArvoContract<
  TContract extends ArvoContract,
  TVersion extends ArvoSemanticVersion & keyof TContract['versions']
> = {
  uri: TContract['uri'];
  version: TVersion;
  description: string | null;
  accepts: {
    type: TContract['type'];
    schema: TContract['versions'][TVersion]['accepts'];
  };
  systemError: {
    type: `sys.${TContract['type']}.error`;
    schema: typeof ArvoErrorSchema;
  };
  emits: TContract['versions'][TVersion]['emits'];
};