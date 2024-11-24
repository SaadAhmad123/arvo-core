import { z } from 'zod';
import {
  ICreateArvoOrchestratorContract,
  ArvoOrchestratorContract,
} from './types';
import { ArvoOrchestratorEventTypeGen } from './typegen';
import { OrchestrationInitEventBaseSchema } from './schema';
import { ArvoSemanticVersion } from '../types';
import { createArvoContract } from '../ArvoContract/helpers';

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
 * The ArvoOrchestratorContract is a specialized contract designed to manage the lifecycle
 * of orchestration processes within the Arvo framework. It creates a contract with an init event
 * type and a corresponding complete event type.
 *
 * Key features:
 * 1. Type Validation: Ensures the type parameter follows lowercase alphanumeric with dots format
 * 2. Event Type Generation: Automatically generates init and complete event types based on the provided type
 * 3. Schema Merging: Merges provided init schemas with the OrchestrationInitEventBaseSchema
 * 4. Version Support: Handles multiple versions of the contract with their respective schemas
 *
 * @template TUri - The URI type for the contract
 * @template TType - The type identifier for the contract events
 * @template TVersions - Record of versions with their corresponding init and complete schemas
 *
 * @param param - Configuration object for the orchestrator contract
 * @param param.uri - The URI that uniquely identifies this contract
 * @param param.type - The base type identifier (must be lowercase alphanumeric with dots)
 * @param param.versions - Record of version configurations
 * @param param.versions[version].init - Zod schema for initialization event (merged with OrchestrationInitEventBaseSchema)
 * @param param.versions[version].complete - Zod schema for completion event
 *
 * @throws {Error} If the type parameter contains invalid characters (must be lowercase alphanumeric with dots)
 *
 * @returns An ArvoOrchestratorContract instance configured with the specified parameters
 *
 * @example
 * ```typescript
 * const contract = createArvoOrchestratorContract({
 *   uri: '#/orchestrators/data/processor',
 *   type: 'data.processor',
 *   versions: {
 *     '1.0.0': {
 *       init: z.object({
 *         data: z.string(),
 *         options: z.object({
 *           format: z.string()
 *         })
 *       }),
 *       complete: z.object({
 *         processedData: z.string(),
 *         metadata: z.record(z.string())
 *       })
 *     },
 *     '1.1.0': {
 *       init: z.object({
 *         data: z.string(),
 *         options: z.object({
 *           format: z.string(),
 *           compression: z.boolean().optional()
 *         })
 *       }),
 *       complete: z.object({
 *         processedData: z.string(),
 *         metadata: z.record(z.string()),
 *         performance: z.object({
 *           duration: z.number(),
 *           bytesProcessed: z.number()
 *         })
 *       })
 *     }
 *   }
 * });
 * ```
 */
export const createArvoOrchestratorContract = <
  TUri extends string,
  TType extends string,
  TVersions extends Record<
    ArvoSemanticVersion,
    {
      init: z.ZodObject<any, any, any>;
      complete: z.ZodObject<any, any, any>;
    }
  >,
>(
  param: ICreateArvoOrchestratorContract<TUri, TType, TVersions>,
) => {
  if (!isLowerAlphanumeric(param.type)) {
    throw new Error(
      `Invalid 'type' = '${param.type}'. The 'type' must only contain alphanumeric characters. e.g. test.orchestrator`,
    );
  }

  return createArvoContract(
    {
      uri: param.uri,
      type: ArvoOrchestratorEventTypeGen.init(param.type),
      versions: Object.fromEntries(
        Object.entries(param.versions).map(([version, contract]) => [
          version,
          {
            accepts: OrchestrationInitEventBaseSchema.merge(contract.init),
            emits: {
              [ArvoOrchestratorEventTypeGen.complete(param.type)]:
                contract.complete,
            },
          },
        ]),
      ),
    },
    true,
  ) as ArvoOrchestratorContract<TUri, TType, TVersions>;
};
