import ArvoEventFactory from '.';
import ArvoContract from '../ArvoContract';
import { ArvoSemanticVersion } from '../types';
import { VersionedArvoContract } from '../ArvoContract/VersionedArvoContract';

/**
 * Creates an ArvoEventFactory for a specific version of a contract.
 *
 * @template TContract - The versioned contract type
 *
 * @param contract - The versioned contract to create a factory for
 * @returns An ArvoEventFactory instance for the specified contract version
 *
 * @example
 * ```typescript
 * const contract = createArvoContract({...});
 * const v1Contract = contract.version('1.0.0');
 * const factory = createArvoEventFactory(v1Contract);
 * ```
 */
export const createArvoEventFactory = <
  TContract extends VersionedArvoContract<
    ArvoContract<any, any, any, any>,
    ArvoSemanticVersion,
    Record<string, any>
  >,
>(
  contract: TContract,
) => new ArvoEventFactory(contract);
