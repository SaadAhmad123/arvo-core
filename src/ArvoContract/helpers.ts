import ArvoContract from '.';
import { ArvoOrchestratorEventTypeGen } from '../ArvoOrchestratorContract/typegen';
import { cleanString } from '../utils';
import { ArvoSemanticVersion } from '../types';
import { z } from 'zod';

/**
 * Creates a validated ArvoContract instance with full control over event types and schemas.
 *
 * @param contract - Contract specification object
 *
 * @throws {Error} If the event types contain reserved prefix ({@link ArvoOrchestratorEventTypeGen})
 * @throws {Error} If any of the ArvoContract's internal validations fail. See {@link ArvoContract}
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
