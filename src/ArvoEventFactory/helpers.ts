import ArvoEventFactory from '.';
import { VersionedArvoContract } from '../ArvoContract/VersionedArvoContract';
import { ArvoOrchestratorContract } from '../ArvoOrchestratorContract/types';
import { ArvoOrchestratorEventFactory } from './Orchestrator';

/**
 * Creates an ArvoEventFactory for a specific version of a contract.
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
  TContract extends VersionedArvoContract<any, any>,
>(
  contract: TContract,
) => new ArvoEventFactory(contract);

/**
 * Creates an ArvoOrchestratorEventFactory instance for handling orchestration events.
 * Provides type-safe event creation with parent-child subject relationship handling.
 *
 * @param contract - The versioned contract for orchestration events
 * @returns An ArvoOrchestratorEventFactory for creating orchestration events
 *
 * @example
 * ```typescript
 * const contract = createArvoOrchestratorContract({ ... });
 * const factory = createArvoOrchestratorEventFactory(contract.version('1.0.0'));
 * const event = factory.init({
 *   source: 'system',
 *   data: { parentSubject$$: null, data: 'value' }
 * });
 * ```
 */
export const createArvoOrchestratorEventFactory = <
  TContract extends VersionedArvoContract<any, any>,
>(
  contract: TContract,
) => new ArvoOrchestratorEventFactory(contract);
