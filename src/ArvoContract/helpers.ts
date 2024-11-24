import { IArvoContract } from './types';
import ArvoContract from '.';
import { ArvoOrchestratorEventTypeGen } from '../ArvoOrchestratorContract/typegen';
import { cleanString } from '../utils';
import { ArvoContractValidators } from './validators';
import { ArvoSemanticVersionSchema } from '../schema';
import ArvoOrchestrationSubject from '../ArvoOrchestrationSubject';
import { ArvoSemanticVersion } from '../types';
import { z } from 'zod';

/**
 * Infers the ArvoContract type from a given IArvoContract interface.
 *
 * @template T - The IArvoContract interface to infer from
 */
type InferArvoContract<T> =
  T extends IArvoContract<infer Uri, infer Type, infer Versions>
    ? ArvoContract<Uri, Type, Versions>
    : never;

/**
 * Creates and validates an ArvoContract instance from a contract specification.
 *
 * @template TContract - The contract specification type, must extend IArvoContract
 * @param contract - The contract specification object containing URI, type, and versioned schemas
 * @throws {Error} If any event type uses the reserved orchestrator prefix
 * @throws {Error} If URI or event types fail validation
 * @returns A properly typed ArvoContract instance
 *
 * @example
 * ```typescript
 * const contract = createArvoContract({
 *   uri: 'com.example.contract',
 *   type: 'input.event',
 *   versions: {
 *     '0.0.1': {
 *       accepts: z.object({ data: z.string() }),
 *       emits: {
 *         'output.event': z.object({ result: z.number() })
 *       }
 *     }
 *   }
 * });
 * ```
 */
export const createArvoContract = <const TContract extends IArvoContract>(
  contract: TContract,
  isOrchestrationContract: boolean = false,
): InferArvoContract<TContract> => {
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

  const isReservedPrefix = (value: string): boolean =>
    !isOrchestrationContract &&
    value.startsWith(ArvoOrchestratorEventTypeGen.prefix);

  if (isReservedPrefix(contract.type)) {
    throw new Error(createErrorMessage('accepts', contract.type, null));
  }

  ArvoContractValidators.contract.uri.parse(contract.uri);

  for (const [version, versionContract] of Object.entries(contract.versions)) {
    ArvoSemanticVersionSchema.parse(version);
    if (version === ArvoOrchestrationSubject.WildCardMachineVersion) {
      throw new Error(
        `The version cannot be ${ArvoOrchestrationSubject.WildCardMachineVersion}`,
      );
    }
    for (const emitType of Object.keys(versionContract.emits)) {
      ArvoContractValidators.record.type.parse(emitType);
      if (isReservedPrefix(emitType)) {
        throw new Error(createErrorMessage('emits', emitType, version));
      }
    }
  }
  return new ArvoContract(contract) as InferArvoContract<TContract>;
};

/**
 * Creates a simplified ArvoContract with standardized type prefixes and emit patterns.
 * This is a convenience function that automatically formats event types according to conventions:
 * - Accept types are prefixed with "com."
 * - Emit types are prefixed with "evt." and suffixed with ".success"
 *
 * @template TUri - The URI type for the contract
 * @template TType - The base type name (without prefixes) for the contract
 * @template TVersions - Record of versions containing accept and emit schemas
 *
 * @param param - The configuration object for creating the contract
 * @param param.uri - The URI identifying the contract
 * @param param.type - The base type name (will be prefixed with "com.")
 * @param param.versions - Version-specific schema definitions
 * @param param.versions[version].accepts - Zod schema for validating incoming events
 * @param param.versions[version].emits - Zod schema for validating outgoing events
 *
 * @returns An ArvoContract instance with standardized type formatting:
 *          - Accept type will be "com.[type]"
 *          - Emit type will be "evt.[type].success"
 *
 * @example
 * ```typescript
 * const contract = createSimpleArvoContract({
 *   uri: 'example.com/contracts/processor',
 *   type: 'document.process',
 *   versions: {
 *     '1.0.0': {
 *       accepts: z.object({
 *         documentId: z.string(),
 *         options: z.object({ format: z.string() })
 *       }),
 *       emits: z.object({
 *         processedDocument: z.string(),
 *         metadata: z.object({ size: z.number() })
 *       })
 *     }
 *   }
 * });
 *
 * // Results in a contract where:
 * // - Accept type is "com.document.process"
 * // - Emit type is "evt.document.process.success"
 * ```
 *
 * @example
 * ```typescript
 * // Multiple versions example
 * const contract = createSimpleArvoContract({
 *   uri: 'api.example/contracts/user',
 *   type: 'user.create',
 *   versions: {
 *     '1.0.0': {
 *       accepts: z.object({ name: z.string() }),
 *       emits: z.object({ id: z.string() })
 *     },
 *     '2.0.0': {
 *       accepts: z.object({
 *         name: z.string(),
 *         email: z.string().email()
 *       }),
 *       emits: z.object({
 *         id: z.string(),
 *         created: z.date()
 *       })
 *     }
 *   }
 * });
 * ```
 *
 * @remarks
 * This function simplifies contract creation by:
 * 1. Automatically prefixing accept types with "com."
 * 2. Creating a single emit type prefixed with "evt." and suffixed with ".success"
 * 3. Maintaining type safety and schema validation
 *
 * Use this when you have a simple contract pattern with:
 * - A single accept type
 * - A single success emit type
 * - Standard type naming conventions
 *
 * For more complex contracts with multiple emit types or custom type naming,
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
>(param: {
  uri: TUri;
  type: TType;
  versions: TVersions;
}) => {
  return createArvoContract({
    uri: param.uri,
    type: `com.${param.type}`,
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
    }
  >;
};
