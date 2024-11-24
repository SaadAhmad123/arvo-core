import { z } from 'zod';
import { ArvoSemanticVersion } from '../types';
import ArvoContract from '../ArvoContract';
import { ArvoOrchestratorEventTypeGen } from './typegen';
import { OrchestrationInitEventBaseSchema } from './schema';

/**
 * Represents an Arvo Orchestrator Contract type that extends the base ArvoContract.
 * This type specifically handles orchestration flows with initialization and completion events.
 *
 * @template TUri - The URI type that uniquely identifies the contract
 * @template TType - The base event type for the orchestrator
 * @template TVersions - Record of versioned schemas for init and complete events
 *
 * @example
 * ```typescript
 * type MyOrchestrator = ArvoOrchestratorContract<
 *   '/orchestrators/payment-flow',
 *   'payment.process',
 *   {
 *     '1.0.0': {
 *       init: z.object({ amount: z.number() }),
 *       complete: z.object({ transactionId: z.string() })
 *     }
 *   }
 * >;
 * ```
 *
 * @remarks
 * - The contract automatically generates appropriate event types for init and complete events
 * - Each version must specify both init and complete schemas
 * - Event types are generated using the ArvoOrchestratorEventTypeGen utility
 */
export type ArvoOrchestratorContract<
  TUri extends string = string,
  TType extends string = string,
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
> = ArvoContract<
  TUri,
  ReturnType<typeof ArvoOrchestratorEventTypeGen.init<TType>>,
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
          typeof ArvoOrchestratorEventTypeGen.complete<TType>
        >]: TVersions[V]['complete'];
      };
    };
  }
>;

/**
 * Interface defining the configuration structure for creating an Arvo Orchestrator Contract.
 * This interface specifies the required properties for initializing a new orchestrator contract.
 *
 * @template TUri - The URI type that uniquely identifies the contract
 * @template TType - The base event type for the orchestrator
 * @template TVersions - Record of versioned schemas for init and complete events
 *
 * @property uri - The unique identifier URI for the contract
 * @property type - The base event type that will be used to generate init/complete event types
 * @property versions - A record of version-specific schemas for initialization and completion events
 *
 * @remarks
 * - The URI should be unique within your system
 * - The type will be used to generate appropriate event type strings
 * - Each version must conform to {@link ArvoSemanticVersion} format
 * - Init and complete schemas should use Zod for validation
 */
export interface ICreateArvoOrchestratorContract<
  TUri extends string,
  TType extends string,
  TVersions extends Record<
    ArvoSemanticVersion,
    {
      init: z.ZodTypeAny;
      complete: z.ZodTypeAny;
    }
  >,
> {
  /** Unique identifier URI for the contract */
  uri: TUri;

  /** Base event type used for generating init/complete event types */
  type: TType;

  /**
   * Version-specific schemas for initialization and completion events
   * @remarks Each version must provide both init and complete schemas
   */
  versions: TVersions;
}
