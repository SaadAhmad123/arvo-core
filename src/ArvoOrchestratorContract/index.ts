import { z } from 'zod';
import ArvoContract from '../ArvoContract';
import { IArvoOrchestratorContract } from './types';

/**
 * Defines the contract for the Arvo Orchestrator, specifying accepted events and emitted events.
 *
 * The ArvoOrchestratorContract is a specialized contract class designed to manage the lifecycle
 * of orchestration processes within the Arvo framework. It extends the base ArvoContract class
 * to provide specific functionality for orchestration scenarios.
 *
 * Key features:
 * 1. Initialization: Defines the structure and validation for the initial event that starts the orchestration.
 * 2. Completion: Specifies the event type and data emitted when the orchestration process concludes.
 * 3. Type Safety: Utilizes TypeScript generics to ensure type consistency across the contract definition.
 * 4. Runtime Validation: Employs Zod schemas for robust runtime type checking and data validation.
 *
 * This contract serves as a crucial component in maintaining consistency and type safety
 * throughout the orchestration process, from initiation to completion.
 *
 * @example
 * ```typescript
 * import { createArvoOrchestratorContract } from 'arvo-core'
 * import { z } from 'zod'
 *
 * const contract = createArvoOrchestratorContract({
 *  uri: '#/example/contract',
 *  name: 'rag',
 *  schema: {
 *    init: z.object({
 *      request: z.string()
 *      vectorStore: z.string(),
 *      llm: z.string()
 *    }),
 *    complete: z.object({
 *      response: z.string()
 *    })
 *  }
 * })
 * ```
 */
export default class ArvoOrchestratorContract<
  TUri extends string = string,
  TInitType extends string = string,
  TInit extends z.ZodTypeAny = z.ZodTypeAny,
  TCompleteType extends string = string,
  TComplete extends z.ZodTypeAny = z.ZodTypeAny,
> extends ArvoContract<
  TUri,
  TInitType,
  TInit,
  { [K in TCompleteType]: TComplete }
> {
  /**
   * Constructs a new ArvoOrchestratorContract instance.
   *
   * @param param - The configuration object for the contract.
   */
  constructor(
    param: IArvoOrchestratorContract<
      TUri,
      TInitType,
      TInit,
      TCompleteType,
      TComplete
    >,
  ) {
    super({
      uri: param.uri,
      accepts: param.init,
      // @ts-ignore
      emits: {
        [param.complete.type]: param.complete.schema,
      },
    });
  }

  /**
   * Gets the initialization event configuration.
   *
   * @returns An object containing the type and schema for the initialization event.
   */
  get init(): {
    type: TInitType;
    schema: TInit;
  } {
    return this.accepts;
  }

  /**
   * Gets the completion event configuration.
   *
   * @returns An object containing the type and schema for the completion event.
   */
  get complete(): {
    type: TCompleteType;
    schema: TComplete;
  } {
    const [type, schema] = Object.entries(this.emits)[0];
    return {
      type: type as TCompleteType,
      schema: schema as TComplete,
    };
  }
}
