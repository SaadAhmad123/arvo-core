import ArvoContract from '.';
import { ArvoOrchestratorEventTypeGen } from '../ArvoOrchestratorContract/typegen';
import { cleanString } from '../utils';
import { ArvoSemanticVersion } from '../types';
import { z } from 'zod';

/**
 * Creates a validated ArvoContract instance with full control over event types and schemas.
 *
 * @template TUri - Contract URI type
 * @template TType - Event type identifier
 * @template TVersions - Record of versioned schemas
 * @template TMetaData - Optional metadata record type
 *
 * @param contract - Contract specification object
 * @param contract.uri - Unique contract identifier
 * @param contract.type - Event type identifier
 * @param contract.versions - Version-specific schema definitions
 * @param contract.metadata - Optional contract metadata
 * @param contract.description - Optional contract description
 *
 * @throws {Error} For invalid URI formats
 * @throws {Error} When using reserved orchestrator prefixes
 * @throws {Error} For invalid version formats
 * @throws {Error} When using wildcard machine versions
 * @throws {Error} For invalid emit type formats
 *
 * @returns A fully typed and validated ArvoContract instance
 *
 * @example
 * ```typescript
 * const contract = createArvoContract({
 *   uri: 'com.example.contract',
 *   type: 'input.event',
 *   description: "Some example contract",
 *   metadata: {
 *     owner: 'team-a',
 *     priority: 'high'
 *   },
 *   versions: {
 *     '1.0.0': {
 *       accepts: z.object({ data: z.string() }),
 *       emits: {
 *         'output.event': z.object({ result: z.number() })
 *       }
 *     }
 *   }
 * });
 * ```
 */
export const createArvoContract = <
  TUri extends string,
  TType extends string,
  TVersions extends Record<
    ArvoSemanticVersion,
    {
      accepts: z.ZodTypeAny;
      emits: Record<string, z.ZodTypeAny>;
    }
  >,
  TMetaData extends Record<string, any> = Record<string, any>,
>(contract: {
  uri: TUri;
  type: TType;
  versions: TVersions;
  metadata?: TMetaData;
  description?: string;
}): ArvoContract<TUri, TType, TVersions, TMetaData> => {
  const createErrorMessage = (
    source: 'accepts' | 'emits',
    type: string,
    version: string | null,
  ): string => {
    const versionString = version ? `, version=${version}` : '';
    return cleanString(`
      In contract (uri=${contract.uri}${versionString}), the '${source}' event (type=${type}) must not start
      with '${ArvoOrchestratorEventTypeGen.prefix}' because this is a reserved pattern
      for Arvo orchestrators.
    `);
  };

  if (ArvoOrchestratorEventTypeGen.isOrchestratorEventType(contract.type)) {
    throw new Error(createErrorMessage('accepts', contract.type, null));
  }

  for (const [version, versionContract] of Object.entries(contract.versions)) {
    for (const emitType of Object.keys(versionContract['emits']))
      if (ArvoOrchestratorEventTypeGen.isOrchestratorEventType(emitType)) {
        throw new Error(createErrorMessage('emits', emitType, version));
      }
  }

  return new ArvoContract({
    uri: contract.uri,
    type: contract.type,
    description: contract.description ?? null,
    metadata: contract.metadata ?? ({} as TMetaData),
    versions: contract.versions,
  });
};

/**
 * Creates an ArvoContract with standardized naming conventions and a simplified event pattern.
 *
 * @template TUri - Contract URI type
 * @template TType - Base event type (without prefixes)
 * @template TVersions - Version-specific schema definitions
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
 *
 * // Generated contract structure:
 * // Accept type: "com.user.create"
 * // Emit type: "evt.user.create.success"
 * // Metadata: {
 * //   contractType: 'SimpleArvoContract',
 * //   rootType: 'user.create'
 * // }
 * ```
 *
 * @remarks
 * Provides a simplified contract creation pattern with standardized conventions:
 * - Automatically prefixes accept types with "com."
 * - Creates a single emit type with "evt." prefix and ".success" suffix
 * - Adds standard metadata identifying it as a SimpleArvoContract
 * - Maintains complete type safety and schema validation
 *
 * For contracts requiring custom event type patterns or multiple emit types,
 * use {@link createArvoContract} instead.
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
  TMetaData extends Record<string, any> = Record<string, any>,
>(param: {
  uri: TUri;
  type: TType;
  versions: TVersions;
  metadata?: TMetaData;
  description?: string;
}) => {
  const mergedMetadata = {
    ...(param.metadata ?? {}),
    contractType: 'SimpleArvoContract',
    rootType: param.type as TType,
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
  }) as ArvoContract<
    TUri,
    `com.${TType}`,
    {
      [V in ArvoSemanticVersion & keyof TVersions]: {
        accepts: TVersions[V]['accepts'];
        emits: {
          [K in `evt.${TType}.succes`]: TVersions[V]['emits'];
        };
      };
    },
    typeof mergedMetadata
  >;
};
