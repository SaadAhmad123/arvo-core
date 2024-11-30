import ArvoContract from '..';
import { ArvoSemanticVersion } from '../../types';
import { z } from 'zod';
import { createArvoContract } from '../helpers';
import { SimpleArvoContract } from './types';

/**
 * Creates an ArvoContract with standardized naming conventions and a simplified event pattern.
 * Use this to create contracts with one emit type only.
 *
 * @param param - Contract configuration
 * @param param.uri - Contract identifier URI
 * @param param.type - Base event type (will be prefixed with "com.")
 * @param param.versions - Version-specific schema definitions
 * @param param.metadata - Optional metadata for the contract
 * @param param.description - Optional contract description
 *
 * @returns ArvoContract with standardized type formatting and metadata
 *
 * @throws {Error} If any of the validations in {@link ArvoContract} or {@link createArvoContract} fail
 *
 * @example
 * ```typescript
 * const contract = createSimpleArvoContract({
 *   uri: 'api.example/contracts/user',
 *   type: 'user.create',
 *   description: 'User creation contract',
 *   versions: {
 *     '1.0.0': {
 *       accepts: z.object({
 *         name: z.string(),
 *         email: z.string().email()
 *       }),
 *       emits: z.object({
 *         userId: z.string(),
 *         timestamp: z.date()
 *       })
 *     }
 *   }
 * });
 * ```
 *
 * @remarks
 * Provides a simplified contract creation pattern with standardized conventions:
 * - Automatically prefixes accept types with "com."
 * - Creates a single emit type with "evt." prefix and ".success" suffix
 * - Adds standard metadata identifying it as a SimpleArvoContract
 */
export const createSimpleArvoContract = <
  TUri extends string,
  TType extends string,
  TVersions extends Record<
    ArvoSemanticVersion,
    {
      accepts: z.ZodTypeAny;
      emits: z.ZodTypeAny;
    }
  >,
  TMetaData extends Record<string, any>,
>(param: {
  uri: TUri;
  type: TType;
  versions: TVersions;
  metadata?: TMetaData;
  description?: string;
}) => {
  const mergedMetadata = {
    ...(param.metadata ?? {}),
    contractType: 'SimpleArvoContract' as const,
    rootType: param.type,
  };

  return createArvoContract({
    uri: param.uri,
    type: `com.${param.type}`,
    description: param.description,
    metadata: mergedMetadata,
    versions: Object.fromEntries(
      Object.entries(param.versions).map(([version, contract]) => [
        version,
        {
          accepts: contract.accepts,
          emits: {
            [`evt.${param.type}.success`]: contract.emits,
          },
        },
      ]),
    ),
  }) as SimpleArvoContract<TUri, TType, TVersions, TMetaData>;
};
