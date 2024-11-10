import { z } from 'zod';
import { ICreateArvoOrchestratorContract } from './types';
import ArvoOrchestratorContract from '.';
import { ArvoOrchestratorEventTypeGen } from './typegen';
import { OrchestrationInitEventBaseSchema } from './schema';

/**
 * Validates if a string contains only uppercase or lowercase alphanumeric characters.
 *
 * This function checks if the input string consists solely of:
 * - Lowercase letters (a-z)
 * - Numbers (0-9)
 * - Dot (.)
 *
 * It does not allow any special characters, spaces, or other non-alphanumeric characters.
 *
 * @param input - The string to be validated.
 * @returns True if the string contains only alphanumeric characters, false otherwise.
 */
function isLowerAlphanumeric(input: string): boolean {
  const alphanumericRegex = /^[a-z0-9.]+$/;
  return alphanumericRegex.test(input);
}

/**
 * Creates an ArvoOrchestratorContract with specified parameters.
 *
 * The ArvoOrchestratorContract is a specialized contract class designed to manage the lifecycle
 * of orchestration processes within the Arvo framework. It extends the base ArvoContract class
 * to provide specific functionality for orchestration scenarios.
 *
 * Key features:
 * 1. Initialization: Defines the structure and validation for the initial event that starts the orchestration.
 *    The init schema is automatically intersected with OrchestrationInitEventBaseSchema.
 * 2. Completion: Specifies the event type and data emitted when the orchestration process concludes.
 * 3. Type Safety: Utilizes TypeScript generics to ensure type consistency across the contract definition.
 * 4. Runtime Validation: Employs Zod schemas for robust runtime type checking and data validation.
 *
 * Base Schema:
 * The OrchestrationInitEventBaseSchema is automatically intersected with the user-provided init schema.
 * This base schema includes essential fields for orchestration, such as:
 * - parentSubject$$: Identifies the subject of the parent process or event in the ArvoEvent system.
 *
 * This contract serves as a crucial component in maintaining consistency and type safety
 * throughout the orchestration process, from initiation to completion.
 *
 * @param param - The configuration object for creating the contract.
 * @param param.uri - The URI for the contract.
 * @param param.name - The name of the contract (must be lowercase alphanumeric with dots).
 * @param param.schema - The schema object containing init and complete Zod schemas.
 * @param param.schema.init - The Zod schema for initialization (will be intersected with OrchestrationInitEventBaseSchema).
 * @param param.schema.complete - The Zod schema for completion.
 *
 * @throws {Error} Throws an error if the name is not lowercase alphanumeric with dots.
 *
 * @returns Returns a new ArvoOrchestratorContract instance with the specified parameters.
 *
 * @example
 * ```typescript
 * import { createArvoOrchestratorContract } from 'arvo-core'
 * import { z } from 'zod'
 *
 * const contract = createArvoOrchestratorContract({
 *   uri: '#/example/contract',
 *   name: 'rag.orchestrator',
 *   schema: {
 *     init: z.object({
 *       request: z.string(),
 *       vectorStore: z.string(),
 *       llm: z.string()
 *     }),
 *     complete: z.object({
 *       response: z.string()
 *     })
 *   }
 * })
 * ```
 *
 * In this example, the actual init schema will be an intersection of the provided schema
 * and the OrchestrationInitEventBaseSchema, ensuring all necessary fields are included.
 */
export const createArvoOrchestratorContract = <
  TUri extends string,
  TName extends string,
  TInit extends z.AnyZodObject,
  TComplete extends z.AnyZodObject,
>(
  param: ICreateArvoOrchestratorContract<TUri, TName, TInit, TComplete>,
) => {
  if (!isLowerAlphanumeric(param.name)) {
    throw new Error(
      `Invalid 'name' = '${param.name}'. The 'name' must only contain alphanumeric characters. e.g. test.orchestrator`,
    );
  }

  const mergedSchema = OrchestrationInitEventBaseSchema.merge(param.schema.init)

  return new ArvoOrchestratorContract<
    TUri,
    ReturnType<typeof ArvoOrchestratorEventTypeGen.init<TName>>,
    typeof mergedSchema,
    ReturnType<typeof ArvoOrchestratorEventTypeGen.complete<TName>>,
    TComplete
  >({
    uri: param.uri,
    init: {
      type: ArvoOrchestratorEventTypeGen.init(param.name),
      schema: mergedSchema,
    },
    complete: {
      type: ArvoOrchestratorEventTypeGen.complete(param.name),
      schema: param.schema.complete,
    },
  });
};
