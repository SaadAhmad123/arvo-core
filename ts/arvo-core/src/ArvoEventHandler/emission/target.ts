import type { VersionedArvoContract } from '../../ArvoContract/versioned/index.js';
import type { ArvoServiceMap } from '../types/services.js';
import type { ArvoEmissionTarget } from './types.js';

/**
 * Where an event of this type goes, or `null` where this version may not
 * emit one. One of this version's outputs completes the execution; a
 * declared service's input opens one there. The handler error type is
 * refused: producing one is the handler's, never an executor's.
 */
export const resolveEmissionTarget = <TSelf extends VersionedArvoContract>(
  self: TSelf,
  services: ArvoServiceMap,
  type: string,
): ArvoEmissionTarget<TSelf> | null => {
  if (type === self.error.type) return null;
  if (Object.hasOwn(self.outputs, type)) {
    return { role: 'completion', contract: self };
  }
  for (const service of Object.values(services)) {
    if (service.type === type) return { role: 'service', contract: service };
  }
  return null;
};
