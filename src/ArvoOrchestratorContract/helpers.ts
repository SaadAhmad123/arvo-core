import { z } from "zod"
import { ICreateArvoOrchestratorContract } from "./types"
import ArvoOrchestratorContract from "."
import { ArvoOrchestratorEventTypeGen } from './typegen'

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
 * 2. Completion: Specifies the event type and data emitted when the orchestration process concludes.
 * 3. Type Safety: Utilizes TypeScript generics to ensure type consistency across the contract definition.
 * 4. Runtime Validation: Employs Zod schemas for robust runtime type checking and data validation.
 *
 * This contract serves as a crucial component in maintaining consistency and type safety
 * throughout the orchestration process, from initiation to completion.
 * 
 * @param param - The configuration object for creating the contract.
 * @param param.uri - The URI for the contract.
 * @param param.name - The name of the contract (must be alphanumeric).
 * @param param.schema - The schema object containing init and complete Zod schemas.
 * @param param.schema.init - The Zod schema for initialization.
 * @param param.schema.complete - The Zod schema for completion.
 * 
 * @throws {Error} Throws an error if the name is not alphanumeric.
 * 
 * @returns Returns a new ArvoOrchestratorContract instance with the specified parameters.
 */
export const createArvoOrchestratorContract = <
  TUri extends string,
  TName extends string,
  TInit extends z.ZodTypeAny,
  TComplete extends z.ZodTypeAny,
>(param: ICreateArvoOrchestratorContract<TUri, TName, TInit, TComplete>) => {

  if (!isLowerAlphanumeric(param.name)) {
    throw new Error(`Invalid 'name' = '${param.name}'. The 'name' must only contain alphanumeric characters.`)
  }

  return new ArvoOrchestratorContract<
    TUri,
    ReturnType<typeof ArvoOrchestratorEventTypeGen.init<TName>>,
    TInit,
    ReturnType<typeof ArvoOrchestratorEventTypeGen.complete<TName>>,
    TComplete
  >({
    uri: param.uri,
    init: {
      type: ArvoOrchestratorEventTypeGen.init(param.name),
      schema: param.schema.init,
    },
    complete: {
      type: ArvoOrchestratorEventTypeGen.complete(param.name),
      schema: param.schema.complete,
    }
  })
}