import { z } from 'zod';

/**
 * Represents the configuration interface for an Arvo Orchestrator Contract.
 * 
 * This interface defines the structure of the configuration object used to initialize
 * an ArvoOrchestratorContract. It specifies the types and schemas for both the
 * initialization event and the completion event of the orchestration process.
 *
 * @template TUri - The type for the URI string that uniquely identifies the contract.
 * @template TInitType - The literal type for the initialization event type.
 * @template TInit - The Zod schema type for validating the initialization event data.
 * @template TCompleteType - The literal type for the completion event type.
 * @template TComplete - The Zod schema type for validating the completion event data.
 */
export interface IArvoOrchestratorContract<
  TUri extends string,
  TInitType extends string,
  TInit extends z.ZodTypeAny,
  TCompleteType extends string,
  TComplete extends z.ZodTypeAny,
> {
  /**
   * The unique identifier for the contract.
   */
  uri: TUri;

  /**
   * Configuration for the initialization event.
   */
  init: {
    /**
     * The type identifier for the initialization event.
     */
    type: TInitType;

    /**
     * The Zod schema used to validate the initialization event data.
     */
    schema: TInit;
  };

  /**
   * Configuration for the completion event.
   */
  complete: {
    /**
     * The type identifier for the completion event.
     */
    type: TCompleteType;

    /**
     * The Zod schema used to validate the completion event data.
     */
    schema: TComplete;
  };
}

/**
 * Interface for creating an Arvo Orchestrator Contract.
 * 
 * This interface defines the structure of the configuration object used to create
 * an ArvoOrchestratorContract. It specifies the URI, name, and schemas for both
 * the initialization and completion events of the orchestration process.
 *
 * @template TUri - The type for the URI string that uniquely identifies the contract.
 * @template TName - The type for the name of the contract.
 * @template TInit - The Zod schema type for validating the initialization event data.
 * @template TComplete - The Zod schema type for validating the completion event data.
 */
export interface ICreateArvoOrchestratorContract<
  TUri extends string,
  TName extends string,
  TInit extends z.ZodTypeAny,
  TComplete extends z.ZodTypeAny,
> {
  /**
   * The unique identifier for the contract.
   * This URI should be used to reference the contract within the system.
   */
  uri: TUri;

  /**
   * The name of the contract.
   * This can be used for display purposes or for easier identification of the contract.
   */
  name: TName;

  /**
   * The schema definitions for the contract events.
   */
  schema: {
    /**
     * The Zod schema used to validate the initialization event data.
     * This schema defines the structure and types of the data required to start the orchestration process.
     */
    init: TInit;

    /**
     * The Zod schema used to validate the completion event data.
     * This schema defines the structure and types of the data emitted when the orchestration process completes.
     */
    complete: TComplete;
  }
}