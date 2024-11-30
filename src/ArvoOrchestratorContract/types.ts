import { z } from 'zod';
import { ArvoSemanticVersion } from '../types';
import ArvoContract from '../ArvoContract';
import { ArvoOrchestratorEventTypeGen } from './typegen';
import { OrchestrationInitEventBaseSchema } from './schema';

/**
 * A specialized ArvoContract type for orchestrating complex event flows.
 * Automatically generates appropriately typed init and complete events.
 *
 * @template TUri - Unique contract identifier URI
 * @template TName - Base name for generating orchestrator event types
 * @template TVersions - Version-specific schemas for init and complete events
 * @template TMetaData - Additional metadata type (optional)
 *
 * @remarks
 * Key characteristics:
 * - Automatically generates init and complete event types using {@link ArvoOrchestratorEventTypeGen}
 * - Enforces schema definitions for both initialization and completion events
 * - Maintains version compatibility with {@link ArvoSemanticVersion}
 * - Includes metadata about contract type and event types
 * - Merges initialization schemas with base orchestration schema
 */
export type ArvoOrchestratorContract<
  TUri extends string = string,
  TName extends string = string,
  TVersions extends Record<
    ArvoSemanticVersion,
    {
      init: z.ZodObject<any, any, any>;
      complete: z.ZodObject<any, any, any>;
    }
  > = Record<
    ArvoSemanticVersion,
    {
      init: z.ZodObject<any, any, any>;
      complete: z.ZodObject<any, any, any>;
    }
  >,
  TMetaData extends Record<string, any> = Record<string, any>,
> = ArvoContract<
  TUri,
  ReturnType<typeof ArvoOrchestratorEventTypeGen.init<TName>>,
  {
    [V in ArvoSemanticVersion & keyof TVersions]: {
      accepts: ReturnType<
        typeof OrchestrationInitEventBaseSchema.merge<
          TVersions[V]['init'],
          TVersions[V]['init']['shape']
        >
      >;
      emits: {
        [K in ReturnType<
          typeof ArvoOrchestratorEventTypeGen.complete<TName>
        >]: TVersions[V]['complete'];
      };
    };
  },
  TMetaData & {
    contractType: 'ArvoOrchestratorContract';
    rootType: TName;
    initEventType: ReturnType<typeof ArvoOrchestratorEventTypeGen.init<TName>>;
    completeEventType: ReturnType<
      typeof ArvoOrchestratorEventTypeGen.complete<TName>
    >;
  }
>;

/**
 * Interface defining the configuration structure for creating an Arvo Orchestrator Contract.
 * This interface specifies the required properties for initializing a new orchestrator contract.
 *
 * @template TUri - The URI type that uniquely identifies the contract
 * @template TType - The base event type for the orchestrator
 * @template TVersions - Record of versioned schemas for init and complete events
 * @template TMetaData - The metadata of the contract
 *
 * @property uri - The unique identifier URI for the contract
 * @property type - The base event type that will be used to generate init/complete event types
 * @property versions - A record of version-specific schemas for initialization and completion events
 * @property metadata - The optional contract metadata
 * @property description - The optional contract description
 *
 * @remarks
 * - The URI should be unique within your system
 * - The type will be used to generate appropriate event type strings
 * - Each version must conform to {@link ArvoSemanticVersion} format
 */
export interface ICreateArvoOrchestratorContract<
  TUri extends string,
  TName extends string,
  TVersions extends Record<
    ArvoSemanticVersion,
    {
      init: z.ZodTypeAny;
      complete: z.ZodTypeAny;
    }
  >,
  TMetaData extends Record<string, any>,
> {
  uri: TUri;
  name: TName;
  versions: TVersions;
  metadata?: TMetaData;
  description?: string;
}
